/**
 * /price 路由可用的 tool 定义
 * 数据源: knowledge/price/data.json（由 scripts/generate.js 从 Obsidian 生成）
 * LLM 通过 function calling 精确获取机酒价格和计算潜水费用
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../../knowledge/price/data.json');

/** 加载结构化价格数据 */
function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

// ============================================================
// lookup_package_price
// ============================================================

export const lookupPackagePrice = {
  type: "function",
  function: {
    name: "lookup_package_price",
    description: "查询指定日期、酒店、行程天数的机酒套餐基础价格（人民币元/人）",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "出发日期，如 '10月1日'" },
        hotel: { type: "string", description: "酒店名称，如 '假日酒店'" },
        duration: { type: "string", enum: ["5天4晚", "6天5晚"] },
        route: { type: "string", description: "出发路线，如 '香港往返'、'澳门往返'" },
      },
      required: ["date", "hotel", "duration"],
    },
  },
};

export function executeLookupPackagePrice(args) {
  const { date, hotel, duration, route } = args;
  const data = loadData();

  // 1. 先查国庆专属套餐
  const natDay = data.nationalDay;
  if (natDay.trips[duration]) {
    const match = natDay.trips[duration].find(t =>
      t.date === date && (!route || t.route.includes(route.replace(/往返|出/g, '').trim()))
    );
    if (match) {
      return {
        source: natDay.name,
        hotel: natDay.hotel,
        date: match.date,
        route: match.route,
        returnDate: match.returnDate,
        duration,
        price: match.price,
      };
    }
  }

  // 2. 查特价（HX 8-10月）
  const hx = data.hxSpecial;
  if (hx.prices) {
    const hxPrice = hx.prices['假日酒店景观房'] || hx.prices['假日酒店'];
    if (hxPrice && hx.dates[duration] && hx.dates[duration].includes(date)) {
      let price = hxPrice[duration];
      const adjKey = `${date}出发`;
      if (hx.adjustments && hx.adjustments[adjKey]) {
        price += hx.adjustments[adjKey];
      }
      return {
        source: `${hx.name}（${hx.airline}）`,
        hotel: '假日酒店',
        date,
        duration,
        basePrice: hxPrice[duration],
        adjustment: hx.adjustments?.[adjKey] || 0,
        price,
        note: "HX2725 香港直飞",
      };
    }
  }

  // 3. 查常规价格
  const reg = data.regular;
  if (reg.seasons) {
    // 先判断季节
    for (const [season, hotels] of Object.entries(reg.seasons)) {
      const h = hotels['假日酒店'];
      if (!h) continue;
      // 默认景观房
      const roomPrices = h['景观房'] || h['海景房'] || Object.values(h)[0];
      if (roomPrices && roomPrices[duration]) {
        // 查是否有航空附加费
        const sur = data.surcharges;
        let surcharge = 0;
        if (sur) {
          // 按日期匹配: '10.1' → 找 '10.1' 在任意航空公司里的规则
          const dateKey = date.replace('月', '.').replace('日', '');
          for (const [_s, airlines] of Object.entries(sur)) {
            for (const [_a, rules] of Object.entries(airlines)) {
              if (rules[dateKey]) surcharge = rules[dateKey];
            }
          }
        }
        return {
          source: `假日酒店常规价格（${season}）`,
          hotel: `假日酒店 景观房`,
          date,
          duration,
          price: roomPrices[duration] + surcharge,
          basePrice: roomPrices[duration],
          surcharge,
          note: surcharge !== 0 ? `含航空公司附加费 ${surcharge > 0 ? '+' : ''}${surcharge}` : "无附加费",
        };
      }
    }
  }

  return { error: `未找到 ${date} ${hotel} ${duration} 的套餐价格` };
}

// ============================================================
// calculate_dive_cost
// ============================================================

export const calculateDiveCost = {
  type: "function",
  function: {
    name: "calculate_dive_cost",
    description: "根据机酒价格和潜水套餐类型，计算完整潜水行程费用明细",
    parameters: {
      type: "object",
      properties: {
        packagePrice: { type: "number", description: "机酒套餐价格（人民币元）" },
        diveDays: { type: "number", enum: [3, 4], description: "潜水日数（5天4晚=3, 6天5晚=4）" },
        packageType: { type: "string", enum: ["standard", "holiday-inn"], description: "standard 或 holiday-inn" },
        excludeTax: { type: "boolean", description: "剔除固定税费 $170" },
        excludeTip: { type: "boolean", description: "剔除潜导小费 $10/天" },
      },
      required: ["packagePrice", "diveDays", "packageType"],
    },
  },
};

export function executeCalculateDiveCost(args) {
  const { packagePrice, diveDays, packageType, excludeTax, excludeTip } = args;
  const RATE = 7.2;
  const FIXED_TAX = 170;
  const TIP_PER_DAY = 10;
  const diveFeePerDay = packageType === "holiday-inn" ? 150 : 170;

  const diveFeeTotal = diveFeePerDay * diveDays;
  const tipTotal = TIP_PER_DAY * diveDays;

  let usdTotal = FIXED_TAX + diveFeeTotal + tipTotal;
  if (excludeTax) usdTotal -= FIXED_TAX;
  if (excludeTip) usdTotal -= tipTotal;

  const usdRmb = usdTotal * RATE;
  const costPrice = packagePrice + usdRmb;
  const rebate = Math.round(packagePrice * 0.1);
  const actualCost = Math.round(costPrice - rebate);

  const breakdown = [];
  breakdown.push({ item: "机酒价格", amount: packagePrice });
  if (!excludeTax) breakdown.push({ item: `固定税费 ($${FIXED_TAX})`, amount: Math.round(FIXED_TAX * RATE) });
  breakdown.push({ item: `潜水费用 (${diveDays}天 × $${diveFeePerDay})`, amount: Math.round(diveFeeTotal * RATE) });
  if (!excludeTip) breakdown.push({ item: `潜导小费 (${diveDays}天 × $${TIP_PER_DAY})`, amount: Math.round(tipTotal * RATE) });

  return {
    packagePrice,
    packageType: packageType === "holiday-inn" ? "假日酒店潜水套餐" : "标准潜水套餐",
    diveDays,
    exchangeRate: RATE,
    usdTotal,
    breakdown,
    costPrice: Math.round(costPrice),
    rebate,
    actualCost,
    profit: 1000 + rebate,
    quote: Math.round(costPrice + 1000),
    excludes: { tax: !!excludeTax, tip: !!excludeTip },
  };
}
