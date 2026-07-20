/**
 * 生成脚本 — 从 Obsidian Vault MD 文件生成知识库
 *
 * 用法：node scripts/generate.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VAULT_DIR = path.join(process.env.HOME, 'Documents/Obsidian Vault/潜水知识库/行程价格速查/帕劳');
const OUT_PRICE = path.join(ROOT, 'knowledge/price');
const OUT_INFO = path.join(ROOT, 'knowledge/info');

// ============================================================
// 工具
// ============================================================

function readMd(name) {
  return fs.readFileSync(path.join(VAULT_DIR, name), 'utf-8');
}

/** 解析数字（去掉粗体 **、逗号、空格） */
function parseNum(s) {
  return parseInt(s.replace(/[*,\s]/g, ''), 10);
}

function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return n.toLocaleString('en-US');
}

/**
 * 逐行解析 MD，识别标题和表格。
 * 返回 [{ level, text, headingLevel, tables:[[[cell,...],...]], content }]
 */
function parseSections(md) {
  const lines = md.split('\n');
  const sections = [];
  let cur = { text: '(root)', headingLevel: 0, tables: [], content: '' };
  sections.push(cur);
  let rows = [];
  let inTable = false;

  function flush() {
    if (rows.length > 0) { cur.tables.push(rows); rows = []; }
    inTable = false;
  }

  for (const line of lines) {
    const hM = line.match(/^(#{2,4})\s+(.+)/);
    if (hM) {
      flush();
      cur = { text: hM[2].trim(), headingLevel: hM[1].length, tables: [], content: '' };
      sections.push(cur);
      continue;
    }
    // 表格行 (支持末尾无 | 的 Markdown 写法)
    const cellMatch = line.match(/^\|(.+?)\|?\s*$/);
    if (cellMatch) {
      if (/^\|[-:\s|]+\|?\s*$/.test(line)) continue; // 分隔行
      rows.push(cellMatch[1].split('|').map(c => c.trim()));
      inTable = true;
      continue;
    }
    if (inTable) flush();
    cur.content += line + '\n';
  }
  flush();
  return sections;
}

/**
 * 解析航空公司附加费：
 * "HX: 7.16-200, 7.21+200, 7.25/30+700, 8.4/8+900"
 * 复合日期 7.25/30 = 7.25 和 7.30 都适用；8.4/8 = 8.4 和 8.8
 */
function parseSurcharges(code) {
  const result = {};
  const lines = code.split('\n').filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(HX|HB|KR)\s*:\s*(.+)/);
    if (!m) continue;
    const airline = m[1];
    const rules = {};
    const items = m[2].split(/,\s*/);
    for (const item of items) {
      const im = item.match(/^(\d+\.\d+(?:\/(?:\d+\.)?\d+)*)\s*([+-]\d+)$/);
      if (!im) continue;
      const datePart = im[1];
      const val = parseInt(im[2], 10);
      // Expand compound: '7.25/30' → ['7.25','7.30'], '8.4/8' → ['8.4','8.8']
      const segs = datePart.split('/');
      const basePrefix = segs[0].substring(0, segs[0].lastIndexOf('.') + 1);
      const dates = [segs[0]];
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i];
        dates.push(s.includes('.') ? s : basePrefix + s);
      }
      for (const d of dates) rules[d] = val;
    }
    if (Object.keys(rules).length > 0) result[airline] = rules;
  }
  return result;
}

// ============================================================
// 构建 data.json
// ============================================================

function buildPriceData(files) {
  // === 国庆假日酒店专属套餐 ===
  const ndSections = parseSections(files['国庆假日酒店专属套餐.md']);
  const nationalDay = { name: '国庆假日酒店专属套餐', hotel: '假日酒店', period: '9月29日-10月9日', trips: {} };
  let ndDur = null;
  for (const sec of ndSections) {
    if (sec.text.match(/6天5晚/)) ndDur = '6天5晚';
    else if (sec.text.match(/5天4晚/)) ndDur = '5天4晚';
    if (!ndDur) continue;
    for (const table of sec.tables) {
      const hdr = table[0].join(',');
      // 国庆表格格式: # | 路线 | 出发日 | 回程日 | 价格
      if (hdr.includes('路线') && hdr.includes('出发日') && hdr.includes('价格')) {
        nationalDay.trips[ndDur] = table.slice(1).map(row => ({
          route: row[1],
          date: row[2],
          returnDate: row[3],
          price: parseNum(row[4]),
        }));
      }
    }
  }

  // === HX 8-10月 特价 ===
  const hxSpecial = { name: 'HX 8-10月特价', airline: 'HX2725', prices: {}, dates: {}, adjustments: {} };
  const spSections = parseSections(files['特价信息.md']);
  let inHx = false;
  for (const sec of spSections) {
    if (sec.text.includes('HX 8-10月特价')) { inHx = true; continue; }
    if (inHx && sec.headingLevel === 2 && !sec.text.includes('HX')) inHx = false;
    if (!inHx) continue;

    for (const table of sec.tables) {
      const hdr = table[0].join(',');
      // 酒店价格表: 酒店 | 5天4晚 | 6天5晚
      if (hdr.includes('5天4晚') && hdr.includes('6天5晚') && hdr.includes('酒店')) {
        for (const row of table.slice(1)) {
          const name = row[0].replace(/\*\*/g, '').replace(/\s+/g, '').trim();
          hxSpecial.prices[name] = {
            '5天4晚': parseNum(row[1]),
            '6天5晚': parseNum(row[2]),
          };
        }
      }
      // 特别注意表
      if (hdr.includes('条件') && hdr.includes('调整')) {
        for (const row of table.slice(1)) {
          const key = row[0].replace(/\*\*/g, '').trim();
          const val = parseNum(row[1]);
          if (!isNaN(val)) hxSpecial.adjustments[key] = val;
        }
      }
      // 出发日期表: 行程 | 出发日
      if (hdr.includes('行程') && hdr.includes('出发日')) {
        for (const row of table.slice(1)) {
          const dur = row[0].replace(/\*\*/g, '').trim();
          hxSpecial.dates[dur] = row[1].replace(/\*\*/g, '').trim();
        }
      }
    }
  }

  // === 假日酒店常规价格（从酒店价格速查提取） ===
  const regular = { seasons: {} };
  const regSections = parseSections(files['酒店价格速查.md']);
  let regSeason = null;
  for (const sec of regSections) {
    if (sec.text.match(/7-8月/) && sec.headingLevel === 2) { regSeason = '旺季'; continue; }
    if (sec.text.match(/9-12月/) && sec.headingLevel === 2) { regSeason = '平季'; continue; }
    if (!regSeason) continue;

    // #### 标题提取酒店名 - 房型
    const hMatch = sec.text.match(/^(.*?)\s*-\s*(.+)/);
    if (!hMatch || !hMatch[1].includes('假日酒店')) continue;
    const hotel = hMatch[1].trim();
    const room = hMatch[2].trim();

    for (const table of sec.tables) {
      const hdr = table[0].join(',');
      // 表格格式: 行程 | 价格
      if (hdr.includes('行程') && hdr.includes('价格')) {
        if (!regular.seasons[regSeason]) regular.seasons[regSeason] = {};
        if (!regular.seasons[regSeason][hotel]) regular.seasons[regSeason][hotel] = {};
        regular.seasons[regSeason][hotel][room] = {};
        for (const row of table.slice(1)) {
          regular.seasons[regSeason][hotel][room][row[0]] = parseNum(row[1]);
        }
      }
    }
  }

  // === 航空附加费 ===
  const surcharges = {};
  const surMd = files['价格备注规则.md'];
  const blocks = surMd.match(/##\s*\d+-\d+月[\s\S]*?```\n([\s\S]*?)```/g);
  if (blocks) {
    for (const block of blocks) {
      const seasonM = block.match(/##\s*(\d+-\d+月)/);
      if (!seasonM) continue;
      const season = seasonM[1];
      const codeM = block.match(/```\n([\s\S]*?)```/);
      if (!codeM) continue;
      surcharges[season] = parseSurcharges(codeM[1]);
    }
  }

  return { nationalDay, hxSpecial, regular, surcharges };
}

// ============================================================
// 生成 system-prompt.md
// ============================================================

function buildPricePrompt(data) {
  const { nationalDay, hxSpecial, regular, surcharges } = data;

  let p = `你是帕劳机酒套餐报价助手。你可以查表获取机酒套餐价格，然后按公式计算潜水行程的完整报价。

## 报价公式

### 标准潜水套餐
- 报价(元) = 机酒价格 + 170 + 潜水日数 × 180 + 1,000
- 成本价(元) = 机酒价格 + 美金合计 × 7.2
- 实际成本价(元) = 成本价 - 机酒价格 × 10%
- 实际利润(元) = 1,000 + 机酒价格 × 10%

### 假日酒店潜水套餐
- 报价(元) = 机酒价格 + 170 + 潜水日数 × 160 + 1,000
- 成本价(元) = 机酒价格 + 美金合计 × 7.2
- 实际成本价(元) = 成本价 - 机酒价格 × 10%

美金合计：5天4晚(3潜水日)=$650, 6天5晚(4潜水日)=$810

## 固定税费说明（$170）
- 天堂保护税 $100
- 出海税 $50
- 接送小费 $20

## 潜水费用
- 标准：潜水 $170/天 + 潜导小费 $10/天 = $180/天
- 假日酒店：潜水 $150/天 + 潜导小费 $10/天 = $160/天

## 汇率
1 USD ≈ 7.2 RMB

## 计价口径
- "不含税"/"不含固定税费" → 剔除 $170 固定税费
- "不含潜导小费" → 剔除潜导小费（$10/天）
- "纯机酒+潜水费" → 机酒价格 + 纯潜水费用（$150/天 × 天数）
- "实际成本价" → 成本价 - 机酒价格 × 10%

## 机酒套餐价格表（人民币元/人）

### ${nationalDay.name}（${nationalDay.period}）
`;

  for (const [dur, trips] of Object.entries(nationalDay.trips)) {
    if (!trips || trips.length === 0) continue;
    p += `\n**${dur}**：\n| 出发日 | 路线 | 回程日 | 价格 |\n|--------|------|--------|------|\n`;
    for (const t of trips) {
      p += `| ${t.date} | ${t.route} | ${t.returnDate} | ${fmt(t.price)} |\n`;
    }
  }

  // HX 特价
  if (hxSpecial.prices && Object.keys(hxSpecial.prices).length > 0) {
    p += `\n### ${hxSpecial.name}（${hxSpecial.airline}）\n\n| 酒店 | 5天4晚 | 6天5晚 |\n|------|:------:|:------:|\n`;
    for (const [name, prices] of Object.entries(hxSpecial.prices)) {
      p += `| ${name} | ${fmt(prices['5天4晚'])} | ${fmt(prices['6天5晚'])} |\n`;
    }
    p += `\n出发日期：${Object.entries(hxSpecial.dates).map(([k, v]) => `${k}（${v}）`).join('、')}\n`;
    const adjs = Object.entries(hxSpecial.adjustments);
    if (adjs.length > 0) {
      p += `加价：${adjs.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('、')}\n`;
    }
  }

  // 常规价格
  for (const [season, hotels] of Object.entries(regular.seasons)) {
    p += `\n### 假日酒店常规价格（${season}）\n`;
    for (const [hotel, rooms] of Object.entries(hotels)) {
      for (const [room, prices] of Object.entries(rooms)) {
        p += `\n**${hotel} ${room}**\n| 行程 | 价格 |\n|------|:----:|\n`;
        for (const [dur, price] of Object.entries(prices)) {
          p += `| ${dur} | ${fmt(price)} |\n`;
        }
      }
    }
  }

  // 附加费
  p += `\n## 航空公司附加费\n`;
  for (const [season, airlines] of Object.entries(surcharges)) {
    p += `\n### ${season}\n`;
    for (const [airline, rules] of Object.entries(airlines)) {
      if (Object.keys(rules).length === 0) continue;
      const items = Object.entries(rules).map(([d, v]) => `${d.replace('.','月')}日 ${v > 0 ? '+' : ''}${v}`);
      p += `- ${airline}：${items.join('、')}\n`;
    }
  }

  p += `\n## 查询优先级
1. 国庆专属套餐（9/29-10/9，假日酒店）→ 最高
2. 特价信息（匹配航司+日期）→ 次优先
3. 常规价格 + 航空公司附加费 → 无特价时适用

## 回答规范
1. 确认日期、酒店、行程天数
2. 查表获取机酒价格
3. 套公式计算各项费用，用分项明细表格呈现
4. 不在知识库中的数据诚实告知
`;
  return p;
}

function buildInfoPrompt(files) {
  const flightSections = parseSections(files['航班信息.md']);
  const flightTable = flightSections.flatMap(s => s.tables).find(t => t[0] && t[0].join(',').includes('航班编号'));

  let schedule = '';
  if (flightTable) {
    schedule = '| 航班 | 始发 | 去程 | 回程 |\n|------|------|------|------|\n';
    for (const row of flightTable.slice(1)) {
      schedule += `| ${row.join(' | ')} |\n`;
    }
  }

  return `你是帕劳旅游信息助手。你可以回答关于帕劳航班、酒店、特价活动、税费政策等问题。

## 航班信息

### 航班时刻
${schedule}
### 航班排期
澳门KR5561：5天4晚每周六出发，6天5晚每周三/六出发
香港HB8235：5天4晚每周日出发，6天5晚每周三/四/六/日出发
香港HX2725：5天4晚每周二出发，6天5晚每周五出发

国庆特殊排期（9/29-10/5）：
- 9/29 澳门往返 KR5561/KR5562
- 9/30 香港往返 HB8235/HB8236
- 10/1 香港往返 HB8235/HB8236
- 10/2 香港往返 HB8235/HB8236
- 10/3 香港出澳门回 HB8235/KR5562
- 10/4 澳门往返 KR5561/KR5562
- 10/5 香港往返 HB8235/HB8236

## 国庆假日酒店专属套餐

| 出发日 | 路线 | 回程日 | 行程 | 价格 |
|--------|------|--------|------|------|
| 9月29日 | 澳门往返 | 10月4日 | 6天5晚 | 7,280 |
| 9月30日 | 香港往返 | 10月5日 | 6天5晚 | 9,080 |
| 10月1日 | 香港往返 | 10月6日 | 6天5晚 | 9,080 |
| 10月2日 | 香港往返 | 10月7日 | 6天5晚 | 8,780 |
| 10月3日 | 香港出澳门回 | 10月8日 | 6天5晚 | 7,280 |
| 10月3日 | 香港往返 | 10月7日 | 5天4晚 | 7,480 |
| 10月4日 | 澳门往返 | 10月8日 | 5天4晚 | 6,280 |
| 10月5日 | 香港往返 | 10月9日 | 5天4晚 | 4,880 |

## 酒店价格概览

### 旺季（7-8月）
| 等级 | 代表酒店 | 5天4晚 | 6天5晚 |
|------|---------|--------|--------|
| 经济 | 尼莫酒店 | 5,480 | 5,680 |
| 精品 | 京品世纪 | 5,680 | 5,880 |
| 舒适 | 假日酒店景观房 | 6,180 | 6,580 |
| 舒适 | 百悦酒店海景房 | 7,980 | 8,780 |
| 豪华 | 老爷酒店园景房 | 9,080 | 10,180 |
| 豪华 | 太平洋海景房 | 11,380 | 12,980 |

### 平季（9-12月）
| 等级 | 代表酒店 | 5天4晚 | 6天5晚 |
|------|---------|--------|--------|
| 经济 | 尼莫酒店 | 3,680 | 4,080 |
| 精品 | 京品世纪 | 3,780 | 4,280 |
| 舒适 | 假日酒店景观房 | 4,480 | 5,080 |
| 舒适 | 百悦酒店海景房 | 5,780 | 6,780 |
| 豪华 | 老爷酒店园景房 | 7,180 | 8,480 |
| 豪华 | 太平洋海景房 | 9,480 | 11,380 |

## 税费与费用说明
- 天堂保护税：$100/人
- 出海税：$50/人
- 接送小费：$10/人/趟（往返$20/人）
- 签证：帕劳免签，免港澳通行证
- 套餐包含：往返机票、酒店住宿（2人1间含早）、接送机车费
- 套餐不含：天堂保护税、接送机小费

## 航空公司附加费（9-12月）
- HX：9月24日 +500，10月8日 -700
- HB：9月25日 +500，10月9日 -500
- KR：9月24日 +500，10月8日 -700

## 回答规范
1. 基于以上知识库信息回答，不要编造
2. 不在知识库中的信息，诚实告知
3. 涉及价格时注明季节/套餐
4. 用表格呈现对比信息
`;
}

// ============================================================
// main
// ============================================================

function main() {
  console.log('📖 读取 Obsidian Vault...\n   ' + VAULT_DIR + '\n');

  if (!fs.existsSync(VAULT_DIR)) {
    console.error('❌ Vault 目录不存在: ' + VAULT_DIR);
    process.exit(1);
  }

  const files = {};
  for (const f of fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.md'))) {
    files[f] = readMd(f);
    console.log('   ✅ ' + f);
  }

  fs.mkdirSync(OUT_PRICE, { recursive: true });
  fs.mkdirSync(OUT_INFO, { recursive: true });

  console.log('\n🔨 生成 /price...');
  const priceData = buildPriceData(files);
  fs.writeFileSync(path.join(OUT_PRICE, 'data.json'), JSON.stringify(priceData, null, 2), 'utf-8');
  console.log('   ✅ data.json');

  const pricePrompt = buildPricePrompt(priceData);
  fs.writeFileSync(path.join(OUT_PRICE, 'system-prompt.md'), pricePrompt, 'utf-8');
  console.log('   ✅ system-prompt.md');

  console.log('\n🔨 生成 /info...');
  const infoPrompt = buildInfoPrompt(files);
  fs.writeFileSync(path.join(OUT_INFO, 'system-prompt.md'), infoPrompt, 'utf-8');
  console.log('   ✅ system-prompt.md');

  console.log('\n🎉 完成！node scripts/generate.js\n');
}

main();
