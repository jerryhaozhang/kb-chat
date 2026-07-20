# KB Chat — 产品需求文档 (PRD)

> 版本: 1.0.0 | 日期: 2026-07-20

## 1. 产品定位

KB Chat 是一个**轻量级知识库对话服务**。将指定目录下的 Markdown 知识文件作为 LLM 上下文，通过 URL 路径区分不同知识库，提供对话式检索和计算能力。

### 1.1 核心价值

- **URL 即知识库** — 一个路径对应一套知识库，新增知识库只需配置
- **计算不靠猜** — 价格计算通过 function calling 在后端执行，而非让 LLM 自己算
- **数据源可追溯** — 所有知识数据从 Markdown 源文件自动生成，一键更新

### 1.2 与普通 RAG 的区别

| | 普通 RAG | KB Chat |
|---|---|---|
| 数据格式 | 向量嵌入 | 全文 Markdown 注入 system prompt |
| 准确性 | 检索可能遗漏 | 全量注入，不遗漏 |
| 计算能力 | LLM 自己算，可能错 | Function calling 后端精确算 |
| 适用场景 | 海量文档 | 中小型结构化知识库（数千字级） |
| 维护成本 | 需向量数据库 | 只需 Markdown + 生成脚本 |

## 2. 使用场景

### 场景 A：帕劳机酒报价（/price）

用户用自然语言询问报价，系统查表获取机酒价格，调用计算函数返回精确费用明细。

```
用户: "10月1日香港往返假日酒店6天5晚，成本价多少？"
系统: 查表(国庆专属套餐 ¥9,080) → 计算(成本价 = 机酒 + 美金合计 × 7.2)
     → 返回: 成本价 ¥14,912, 实际成本价 ¥14,004
```

### 场景 B：帕劳旅游信息（/info）

用户查询航班、酒店、特价、税费等通用信息。

```
用户: "国庆期间有哪些航班？假日酒店有什么特价？"
系统: 检索内置知识库 → 返回完整排期和价格表
```

## 3. 功能需求

### 3.1 路由映射

| URL | 用途 | 工具 |
|-----|------|------|
| `POST /price` | 报价查询 + 计算 | `lookup_package_price`, `calculate_dive_cost` |
| `POST /info` | 信息检索 | 无（纯 LLM 问答） |
| `GET /` | 路由列表 | — |
| `GET /health` | 健康检查 | — |

### 3.2 价格计算工具

#### lookup_package_price
查询机酒套餐价格，按优先级依次匹配：
1. 国庆专属套餐（最高优先）
2. 特价信息（航司+日期匹配）
3. 常规价格 + 航空公司附加费

#### calculate_dive_cost
根据机酒价格计算完整潜水行程费用：
- 成本价 = 机酒价格 + 美金合计 × 汇率
- 实际成本价 = 成本价 - 机酒价格 × 10%
- 报价 = 成本价 + ¥1,000

支持口径参数：
- `excludeTax: true` — 剔除 $170 固定税费
- `excludeTip: true` — 剔除 $10/天潜导小费

### 3.3 数据生成

- `npm run generate` 从 Obsidian vault 读取 MD 源文件自动生成 `knowledge/` 下的 `system-prompt.md` 和 `data.json`
- 生成过程：解析 Markdown → 提取表格 → 结构化 → 输出

### 3.4 请求/响应格式

```json
// 请求
POST /price
{"message": "10月1日假日酒店香港往返成本价"}

// 响应
{
  "route": "/price",
  "kb": "帕劳报价查询",
  "reply": "根据查询结果，以下是您的费用明细：\n\n..."
}
```

## 4. 非功能需求

- 服务端口: 3100
- API 延迟: < 5s（取决于 DeepSeek API 响应速度）
- 数据更新: 修改 Obsidian MD → 运行 generate → 重启服务
- 运行环境: Node.js ≥ 18

## 5. 数据流

```
Obsidian Vault (MD 源文件)
       │ node scripts/generate.js
       ▼
knowledge/price/
  ├── data.json          ← 结构化数据（价格表 JSON）
  └── system-prompt.md   ← LLM 上下文（自然语言+表格）
knowledge/info/
  └── system-prompt.md   ← 信息知识库
       │
       ▼ 服务启动时加载
  DeepSeek API ← 对话请求 → Express Server
       │                       │
       │ function calling      │
       │ (lookup + calculate)  │
       ▼                       │
  price-tools.js               │
  (从 data.json 查表+计算) ─────┘
```

## 6. 扩展性

### 新增知识库（如 /hotel 酒店详情）

1. 在 `config.yaml` 的 `routes` 下加一条：
```yaml
  /hotel:
    name: "酒店详细信息"
    description: "查询帕劳各酒店房型、设施、价格"
    systemPromptFile: "knowledge/hotel/system-prompt.md"
    tools: []
```

2. 创建 `knowledge/hotel/system-prompt.md`

3. 重启服务

### 新增计算工具（如多酒店对比）

1. 在 `src/lib/price-tools.js` 添加新的 function definition + execute 函数
2. 在 `TOOL_REGISTRY` 注册
3. 在 `config.yaml` 对应路由的 `tools` 列表中加工具名

## 7. 已知限制

- 知识库大小受 LLM context window 限制（当前 ~3000 字，远低于 128K 上限）
- 当前仅支持 DeepSeek API（OpenAI 兼容格式），切换至 Claude API 需修改 `src/llm.js`
- 表格解析依赖 MD 源文件格式稳定，格式变化可能导致解析失败
- 对话无状态，不支持多轮上下文（每次请求独立）
