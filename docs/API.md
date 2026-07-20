# KB Chat — API 文档

> Base URL: `http://localhost:3100`

## 路由一览

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/` | 获取所有路由列表 |
| `GET` | `/health` | 健康检查 |
| `POST` | `/price` | 帕劳报价查询 |
| `POST` | `/info` | 帕劳信息查询 |

---

## GET /

返回所有已注册的知识库路由。

**响应示例**：
```json
{
  "service": "KB Chat",
  "routes": [
    {
      "path": "/price",
      "name": "帕劳报价查询",
      "description": "查询帕劳机酒+潜水套餐价格，自动计算成本价、实际成本价等",
      "tools": ["lookup_package_price", "calculate_dive_cost"]
    },
    {
      "path": "/info",
      "name": "帕劳航班与酒店信息",
      "description": "查询帕劳航班排期、酒店信息、特价活动、税费规则等",
      "tools": []
    }
  ]
}
```

---

## GET /health

**响应示例**：
```json
{
  "status": "ok",
  "routes": ["/price", "/info"]
}
```

---

## POST /price

查询帕劳机酒+潜水套餐价格，自动计算各项费用。

### Request

```json
{
  "message": "10月1日出发 香港往返 假日酒店 6天5晚 成本价和实际成本价各多少？"
}
```

**message 示例**：
- `"10月1日假日酒店香港往返成本价"`
- `"9月30日香港往返假日酒店6天5晚，按假日潜水套餐，实际成本价"`
- `"国庆假日酒店各日期价格对比"`
- `"10月1日不含税不含小费的成本价"`

### 计价口径关键词

| 用户说法 | 系统行为 |
|---------|---------|
| 成本价 | 返回 costPrice（全含） |
| 实际成本价 | 返回 actualCost（扣返点10%） |
| 不含税 / 不含税费 | excludeTax=true |
| 不含小费 / 不含潜导小费 | excludeTip=true |
| 纯机酒+潜水费 | 仅机酒 + 纯潜水费（$150/天） |
| 报价 | 返回 quote（成本价 + ¥1,000） |

### Response

```json
{
  "route": "/price",
  "kb": "帕劳报价查询",
  "reply": "根据查询结果，以下是您的费用明细：\n\n## 10月1日 香港往返 假日酒店 6天5晚\n\n..."
}
```

### Function Calling 机制

`/price` 路由注册了两个工具，LLM 自动决定何时调用：

1. **`lookup_package_price`** — 查机酒套餐价格
   - 参数：`date`, `hotel`, `duration`, `route?`
   - 返回：`{ source, hotel, date, route, duration, price }`

2. **`calculate_dive_cost`** — 计算完整潜水行程费用
   - 参数：`packagePrice`, `diveDays`, `packageType`, `excludeTax?`, `excludeTip?`
   - 返回：`{ costPrice, actualCost, quote, breakdown[], excludes }`

---

## POST /info

查询帕劳航班、酒店、特价、税费等通用信息。

### Request

```json
{
  "message": "国庆期间有哪些航班？假日酒店有什么特价？"
}
```

**message 示例**：
- `"国庆有哪些航班"`
- `"假日酒店的特价有哪些"`
- `"帕劳税费怎么算"`
- `"旺季和平季假日酒店差多少"`

### Response

```json
{
  "route": "/info",
  "kb": "帕劳航班与酒店信息",
  "reply": "好的，根据您提供的信息，为您整理帕劳国庆期间..."
}
```

### 与 /price 的区别

| | /price | /info |
|------|--------|-------|
| 能力 | 查价 + 精确计算 | 信息问答 |
| Tools | lookup_package_price, calculate_dive_cost | 无 |
| 适用 | "XX日XX酒店多少钱" | "XX酒店有哪些房型" |

---

## 错误响应

### 路由不存在
```json
HTTP 404
{ "error": "Not found" }
```

### 缺少参数
```json
HTTP 400
{ "error": "message (string) is required" }
```

### LLM 调用失败
```json
HTTP 502
{ "error": "LLM error: DeepSeek API error 500: ..." }
```

---

## curl 测试示例

```bash
# 报价查询
curl -s -X POST http://localhost:3100/price \
  -H 'Content-Type: application/json' \
  -d '{"message":"10月1日香港往返假日酒店6天5晚成本价"}' \
  | python3 -m json.tool

# 信息查询
curl -s -X POST http://localhost:3100/info \
  -H 'Content-Type: application/json' \
  -d '{"message":"国庆期间有哪些航班排期？"}' \
  | python3 -m json.tool

# 路由列表
curl -s http://localhost:3100/ | python3 -m json.tool

# 健康检查
curl -s http://localhost:3100/health
```

---

## 对话约束

- 单次请求，无多轮上下文（每次独立）
- LLM temperature = 0.1（低随机性）
- Function calling 最多 5 轮
- 回答基于 system prompt 中的知识库数据，不会编造
