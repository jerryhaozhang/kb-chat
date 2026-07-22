# 知识库更新 SOP

> 从上游 Obsidian 知识库变更到服务器端线上生效的完整流程。

## 触发条件

- 上游（人工/供应商）提供新的价格表、航班排期、特价信息等
- Obsidian 知识库 `潜水知识库/行程价格速查/帕劳/` 中任意 `.md` 文件发生变更

## 涉及的关键路径

| 角色 | 路径 |
|------|------|
| Obsidian Vault | `~/Documents/Obsidian Vault/潜水知识库/行程价格速查/帕劳/` |
| 本地项目 | `/Users/jerry/AIWorkspace/project-009-kb-chat/` |
| 生成脚本 | `scripts/generate.js` |
| 生成产物 | `knowledge/price/data.json`, `knowledge/price/system-prompt.md`, `knowledge/info/system-prompt.md` |
| 服务器 | `root@124.222.56.216:/data/kb-chat/` |
| GitHub | `https://github.com/jerryhaozhang/kb-chat` |

## 流程

### Step 1 — 分析变更内容

拿到新的价格表/信息后，先评估影响范围：

1. **读取当前 Obsidian 知识库文件**（使用 `mcp__obsidian__read_file`）
   - `酒店价格速查.md` — 各季节酒店基础价格
   - `特价信息.md` — 特价促销
   - `国庆假日酒店专属套餐.md` — 假日酒店国庆专属
   - `价格备注规则.md` — 航司/酒店附加费
   - `航班信息.md` — 航班时刻表
   - `行程价格速查索引.md` — 速查流程和索引

2. **识别受影响文件**：判断新数据是新增、修改还是替代现有数据
3. **列出变更清单**：告知用户要改哪些文件，确认后再改

### Step 2 — 更新 Obsidian 知识库

使用 `mcp__obsidian__search_replace_in_file` 或 `mcp__obsidian__update_section` 精确修改：

- 新增数据章节（如国庆价格表）
- 更新引用的交叉链接
- 标记过期条目（用 `~~删除线~~`）
- 更新索引页的速查流程和优先级

**原则**：Obsidian 是唯一数据源，generate.js 只是解析器。

### Step 3 — 评估 generate.js 是否需要调整

不是每次 Obsidian 变更都需要改 generate.js。判断标准：

| 场景 | 需要改 generate.js？ |
|------|:---:|
| 现有章节中数值变更（如酒店降价） | ❌ 不需要，脚本自动解析 |
| 新增表格行（新酒店/新房型加入现有表） | ❌ 不需要，脚本已覆盖 |
| 新增**章节/表格结构**（如新增一个季节价格表） | ✅ 需要新增解析逻辑 |
| 章节标题格式改变 | ✅ 需要适配匹配规则 |
| 表格列结构改变（如新增出发日期列） | ✅ 需要适配列解析 |
| system prompt 硬编码信息过时（如查询优先级） | ✅ 需要更新 |

**原则**：generate.js 解析逻辑的稳定性和低耦合优先。只在结构性变化时改脚本。

### Step 4 — 本地运行 generate.js 测试

```bash
cd /Users/jerry/AIWorkspace/project-009-kb-chat
node --check scripts/generate.js   # 语法检查
node scripts/generate.js           # 生成 knowledge/ 文件
```

验证生成结果：

```bash
# 检查 data.json 中新增字段
python3 -c "
import json
with open('knowledge/price/data.json') as f:
    data = json.load(f)
# 按需验证具体字段
print(data.keys())
"

# 预览 system-prompt.md
head -100 knowledge/price/system-prompt.md
grep "关键词" knowledge/price/system-prompt.md
```

**失败处理**：
- 如果输出为空/缺失 → 检查 `parseSections` 是否匹配到目标章节（用调试脚本 dump sections）
- 如果数值不正确 → 检查 `parseNum` 是否正常解析
- 如果章节跳过 → 检查 `inHoliday` 等标志位和 `headingLevel` 断点

### Step 5 — 生成部署文件

确认 `knowledge/` 目录下的三个文件已更新：

```
knowledge/price/data.json          # 结构化价格数据
knowledge/price/system-prompt.md   # /price 路由 LLM 上下文
knowledge/info/system-prompt.md    # /info 路由 LLM 上下文
```

### Step 6 — 上传至服务器

服务器没有 git，用 `scp` 上传：

```bash
# 一次性上传所有更新的文件
scp \
  scripts/generate.js \
  knowledge/price/data.json \
  knowledge/price/system-prompt.md \
  knowledge/info/system-prompt.md \
  root@124.222.56.216:/data/kb-chat/

# 重启服务
ssh root@124.222.56.216 "pm2 restart kb-chat"
```

### Step 7 — 验证线上

```bash
# 健康检查
ssh root@124.222.56.216 "curl -sk https://localhost/inside_knowledge/health"

# 实际查询测试（用新数据中的日期/酒店验证）
ssh root@124.222.56.216 "curl -sk -X POST https://localhost/inside_knowledge/price \
  -H 'Content-Type: application/json' \
  -d '{\"message\":\"<真实测试查询>\"}'"
```

**注意**：查询接口可能返回 502 表示文件缺失，检查是否漏传文件。

### Step 8 — Commit & Push

```bash
cd /Users/jerry/AIWorkspace/project-009-kb-chat
git add -A
git commit -m "feat: <简短描述>"
git push origin main
```

同时更新 `docs/CHANGELOG.md` 记录本次变更。

## 常见问题

### Q: generate.js 解析不到新表格
**排查**：用如下调试代码 dump 章节结构
```bash
node -e "
// 复制 parseSections + 遍历所有 section，打印 heading 和 tables 数量
"
```
常见原因：`headingLevel` 断点过早（子章节被截断）、`continue` 跳过了目标 section 自带的表格、表格 header 匹配条件不完整。

### Q: 服务器上 scp 路径
`scp` 不支持目录递归到嵌套路径，如果目标目录不存在会报错。目标路径的父目录（`/data/kb-chat/knowledge/price/` 等）必须已存在。

### Q: 改 Obsidian 后线上多久生效
没有自动同步。必须手动执行 Step 4→5→6→7。全流程约 5 分钟。

## 文件对应关系

```
Obsidian Vault                                generate.js 解析函数      线上服务路由
─────────────────────────────────────────────────────────────────────────────────
酒店价格速查.md ───────────────→ buildPriceData() → holidayFull ──→ /price + /info
国庆假日酒店专属套餐.md ───────→ buildPriceData() → nationalDay  ──→ /price + /info
特价信息.md ───────────────────→ buildPriceData() → hxSpecial   ──→ /price
价格备注规则.md ───────────────→ buildPriceData() → surcharges  ──→ /price
航班信息.md ───────────────────→ buildInfoPrompt()→ schedule    ──→ /info
```
