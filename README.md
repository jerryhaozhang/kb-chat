# KB Chat · 奕海智能销售助理

轻量级知识库对话服务。将 Markdown 知识文件全量注入 LLM system prompt，通过 function calling 实现精确计算，提供 Chat 前端界面。

**生产地址**：https://www.yhdive.com/inside_knowledge/

## 特性

- **URL 即知识库** — 一个路径对应一套知识库，新增只需配置
- **计算不靠猜** — 价格计算通过 function calling 在后端精确执行
- **数据源可追溯** — 知识数据从 Obsidian Markdown 源文件自动生成
- **统一 Chat 界面** — 单文件 HTML 前端，零依赖，Markdown 渲染，移动端适配

## 快速开始

```bash
npm install
cp .env.example .env    # 填入 DeepSeek API Key
npm run dev             # http://localhost:3100
```

## 项目结构

```
├── config.yaml              # 核心配置：端口、路由映射
├── public/
│   └── index.html           # 前端 Chat 页面
├── src/
│   ├── server.js            # Express 入口 + POST /chat
│   ├── config.js            # 配置加载
│   ├── llm.js               # DeepSeek API 封装
│   ├── routes/chat.js       # 对话路由 + function calling
│   └── lib/price-tools.js   # 价格计算引擎
├── knowledge/               # 知识库（由 generate.js 生成）
│   ├── price/               # 报价数据 + system prompt
│   └── info/                # 信息检索 system prompt
├── scripts/generate.js      # 从 Obsidian Vault 生成 knowledge/
└── docs/                    # 技术文档
```

## API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/` | Chat 页面 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/api/routes` | 路由列表 |
| `POST` | `/chat` | 统一对话（合并所有知识库 + 计算工具） |
| `POST` | `/price` | 报价查询（保留） |
| `POST` | `/info` | 信息检索（保留） |

```bash
# 测试
curl -X POST http://localhost:3100/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"10月1日香港往返假日酒店6天5晚成本价"}'
```

## 更新知识库

```bash
# 1. 修改 Obsidian 中的 MD 源文件
# 2. 重新生成
node scripts/generate.js
# 3. 重启服务
```

## 新增知识库

编辑 `config.yaml`：

```yaml
routes:
  /my-kb:
    name: "我的知识库"
    description: "..."
    systemPromptFile: "knowledge/my-kb/system-prompt.md"
    tools: []
```

创建对应的 `system-prompt.md`，重启服务即可。

## 生产部署

```bash
# 服务器：腾讯云 124.222.56.216 (CentOS 7)
# 需要 Node.js 16+（CentOS 7 glibc 2.17 不支持 Node 18）
# 进程管理：pm2
# 反向代理：Nginx /inside_knowledge/ -> :3100

ssh root@124.222.56.216
pm2 restart kb-chat
```

详细部署文档见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vanilla HTML/CSS/JS（零依赖） |
| 后端 | Express.js (ESM) |
| LLM | DeepSeek API (OpenAI 兼容) |
| 配置 | YAML |
| 知识库 | Markdown 全量注入 |

## 文档

- [PRD.md](docs/PRD.md) — 产品需求文档
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术架构
- [API.md](docs/API.md) — API 文档
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发指南
- [CHANGELOG.md](docs/CHANGELOG.md) — 开发记录和问题解决
