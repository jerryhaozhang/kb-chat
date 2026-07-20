# KB Chat — 技术架构文档

> 版本: 1.0.0 | 日期: 2026-07-20

## 1. 项目结构

```
project-009-kb-chat/
├── config.yaml                        # 核心配置：端口、路由映射
├── package.json                       # Node.js 项目配置
├── .env                               # API Key（不提交）
│
├── knowledge/                         # 知识库文件（由 generate.js 生成）
│   ├── price/
│   │   ├── data.json                  # 结构化价格数据
│   │   └── system-prompt.md           # /price 路由的 LLM 上下文
│   └── info/
│       └── system-prompt.md           # /info 路由的 LLM 上下文
│
├── scripts/
│   └── generate.js                    # 从 Obsidian Vault 生成 knowledge/ 文件
│
├── public/
│   └── index.html                     # 前端 Chat 页面（单文件 HTML）
│
├── src/
│   ├── server.js                      # Express 入口，动态注册路由 + POST /chat
│   ├── config.js                      # 读取 config.yaml + 加载 system prompt
│   ├── llm.js                         # DeepSeek API 调用封装（node-fetch）
│   ├── routes/
│   │   └── chat.js                    # 对话路由：LLM + function calling 循环
│   └── lib/
│       └── price-tools.js             # /price 工具：价格查表 + 费用计算
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DEVELOPMENT.md
│   ├── CHANGELOG.md
│   └── favicon.png
```

## 2. 核心模块

### 2.1 server.js — 入口

```
Express App
  ├── GET /                  → index.html (Chat 页面)
  ├── GET /health            → { status: "ok", routes: [...] }
  ├── GET /api/routes        → 路由列表 JSON
  ├── POST /chat             → 统一知识库对话（合并 /price + /info）
  └── POST /{route}          → 动态注册的原有路由 (/price, /info)
```

静态文件服务（`express.static('public')`）优先于 API 路由，`GET /` 返回前端页面。

动态路由机制：
```javascript
// 读取 config.yaml → 遍历 routes → 为每个 path 注册 POST 路由
for (const routePath of Object.keys(config.routes)) {
  app.post(routePath, chatRouter);
}
```

### 2.2 config.js — 配置加载

1. 读取 `config.yaml`
2. 读取每个 route 的 `systemPromptFile`，将内容注入 `route.systemPrompt`
3. 暴露 `config.routes`、`config.server.port`

### 2.3 llm.js — LLM 调用

封装 DeepSeek API（OpenAI 兼容格式）：

```javascript
export async function chat(messages, { tools } = {}) {
  // POST https://api.deepseek.com/v1/chat/completions
  // 支持 tools (function calling), temperature=0.1
}
```

**设计决策**：
- `temperature: 0.1` — 价格计算场景需要确定性输出
- `max_tokens: 2048` — 回答通常几百字，无需过长
- 如需切换至 Claude API，只需修改此文件

### 2.4 chat.js — 对话路由

单个 `handleChat` 函数处理所有路由请求：

```
用户消息
  → 匹配 URL path → 获取对应 route 配置
  → 注入 system prompt + tools
  → 调用 LLM (DeepSeek API)
  → LLM 返回 function call?
     ├── 是 → 执行 tool → 追加结果到 messages → 再次调 LLM
     └── 否 → 返回最终 reply
```

**Tool Registry**：
```javascript
const TOOL_REGISTRY = {
  lookup_package_price: { definition, execute },
  calculate_dive_cost:   { definition, execute },
};
```

**Function Calling 循环**：最多 5 轮，防止无限循环。每轮：
1. LLM 返回 `tool_calls`
2. 后端根据 `tool_calls[].function.name` 调对应 execute
3. 结果以 `role: "tool"` 追回 messages
4. 再次调 LLM

### 2.5 price-tools.js — 计算引擎

**数据加载**：服务启动时从 `knowledge/price/data.json` 读取（源码硬编码已移除）。

**lookup_package_price**：
```
输入: { date, hotel, duration, route }
  → 1. 匹配 nationalDay.trips[duration]（国庆专属）
  → 2. 匹配 hxSpecial.prices + hxSpecial.dates（HX 特价）
  → 3. 匹配 regular.seasons[season][hotel][room][duration] + surcharges（常规）
  → 输出: { source, hotel, date, price, ... }
```

**calculate_dive_cost**：
```
输入: { packagePrice, diveDays, packageType, excludeTax?, excludeTip? }
  → 固定公式计算：
    usdTotal = 170(税) + diveDays*(150或170) + diveDays*10(小费)
    成本价 = packagePrice + usdTotal * 7.2
    实际成本价 = 成本价 - packagePrice * 0.1
    报价 = 成本价 + 1000
  → 输出: { costPrice, actualCost, profit, quote, breakdown[] }
```

## 3. 数据流

```
Obsidian
/潜水知识库/行程价格速查/帕劳/*.md
       │
       │ scripts/generate.js
       │  parseSections() → extractTables() → buildPriceData()
       ▼
knowledge/price/data.json    ← JSON 结构见下方
knowledge/price/system-prompt.md
knowledge/info/system-prompt.md
       │
       │ server.js 启动 → config.js 加载 system-prompt.md
       │ chat.js 运行时 → price-tools.js 动态读 data.json
       ▼
Express Server (:3100) ←→ DeepSeek API
```

### data.json 结构

```json
{
  "nationalDay": {
    "name": "国庆假日酒店专属套餐",
    "period": "9月29日-10月9日",
    "trips": {
      "6天5晚": [{ "route": "香港往返", "date": "10月1日", "price": 9080 }],
      "5天4晚": [...]
    }
  },
  "hxSpecial": {
    "name": "HX 8-10月特价",
    "airline": "HX2725",
    "prices": { "假日酒店景观房": { "5天4晚": 4050, "6天5晚": 4500 } },
    "dates": { "6天5晚": "8月27日、9月5日..." },
    "adjustments": { "9月24日出发": 500 }
  },
  "regular": {
    "seasons": {
      "平季": {
        "假日酒店": {
          "景观房": { "5天4晚": 4480, "6天5晚": 5080 },
          "海景房": { "5天4晚": 4680, "6天5晚": 5280 }
        }
      },
      "旺季": { ... }
    }
  },
  "surcharges": {
    "9-12月": {
      "HX": { "9.24": 500, "10.8": -700 },
      "HB": { "9.25": 500, "10.9": -500 },
      "KR": { "9.24": 500, "10.8": -700 }
    }
  }
}
```

## 4. 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 后端框架 | Express.js | 轻量，无学习成本 |
| LLM API | DeepSeek (OpenAI 格式) | 免费/低成本，已配置 |
| 配置格式 | YAML | 人类可读，比 JSON 更友好 |
| 知识库格式 | Markdown | 源文件即知识库，非开发者可维护 |
| 数据生成 | 自写解析器 | 无外部依赖，针对特定 MD 格式优化 |
| 模块化 | ESM | Node.js 现代标准 |

## 5. 并发模型

- 单进程 Express，无状态
- 每个请求独立，不共享会话
- Function calling 循环在单请求内串行（每轮等 LLM 返回）
- 如需多用户并发，由 Express 事件循环自然处理

## 6. 安全考虑

- API Key 通过 `.env` 文件管理（已 `.gitignore`）
- 无认证机制（内网服务，不暴露公网）
- 请求体限制：Express 默认 JSON 100KB（`express.json({ limit: '1mb' })` 未显式设置）
- 无用户输入直接拼接 SQL 或 Shell（无注入风险）
