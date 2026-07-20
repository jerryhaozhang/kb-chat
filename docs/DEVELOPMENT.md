# KB Chat — 开发指南

## 快速开始

```bash
cd /Users/jerry/AIWorkspace/project-009-kb-chat
npm install
cp .env.example .env    # 填入 API Key（已有则跳过）
npm run dev              # 启动开发服务器（热更新）
```

访问 `http://localhost:3100/` 打开 Chat 页面。

## 生产部署

```bash
# 服务器信息见 Obsidian「服务器信息/腾讯云」
ssh root@124.222.56.216

# 服务目录
/data/kb-chat/

# 进程管理
pm2 list                  # 查看进程
pm2 restart kb-chat       # 重启服务
pm2 logs kb-chat          # 查看日志

# 访问地址
https://www.yhdive.com/inside_knowledge/
```

## 环境变量

`.env` 文件配置：

```bash
DEEPSEEK_API_KEY=sk-xxx          # DeepSeek API Key（必填）
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1  # API 地址（有默认值）
DEEPSEEK_MODEL=deepseek-chat     # 模型名（有默认值）
```

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动开发服务器（`--watch` 热更新） |
| `npm start` | 生产模式启动 |
| `npm run generate` / `node scripts/generate.js` | 从 Obsidian 重新生成 knowledge/ |

## 更新知识库数据

```
1. 在 Obsidian 中修改 MD 文件
   → ~/Documents/Obsidian Vault/潜水知识库/行程价格速查/帕劳/

2. 运行生成脚本
   $ node scripts/generate.js

3. 重启服务（热更新不支持 knowledge/ 文件）
   $ npm run dev
```

## 新增知识库

编辑 `config.yaml`，在 `routes` 下添加：

```yaml
routes:
  /my-kb:
    name: "我的知识库"
    description: "简短描述"
    systemPromptFile: "knowledge/my-kb/system-prompt.md"
    tools: []    # 可选，如 ["lookup_package_price"]
```

然后创建 `knowledge/my-kb/system-prompt.md`，写入知识库内容：

```markdown
你是XX领域助手。

## 数据表1
...
```

重启服务即可通过 `POST /my-kb` 访问。

## 新增计算工具

1. 在 `src/lib/` 下创建工具文件（参考 `price-tools.js`）

```javascript
import fs from 'node:fs';
// ... 数据加载逻辑

export const myTool = {
  type: "function",
  function: {
    name: "my_tool",
    description: "工具描述",
    parameters: {
      type: "object",
      properties: {
        arg1: { type: "string", description: "..." }
      },
      required: ["arg1"],
    },
  },
};

export function executeMyTool(args) {
  // 计算逻辑
  return { result: args.arg1 };
}
```

2. 在 `src/routes/chat.js` 注册：

```javascript
import { myTool, executeMyTool } from '../lib/my-tool.js';

const TOOL_REGISTRY = {
  // ...existing
  my_tool: { definition: myTool, execute: executeMyTool },
};
```

3. 在 `config.yaml` 对应路由添加工具名：

```yaml
tools:
  - my_tool
```

## 文件说明

### config.yaml

```yaml
server:
  port: 3100          # 服务端口

routes:
  /price:             # URL 路径
    name: "..."       # 显示名
    systemPromptFile: "knowledge/price/system-prompt.md"  # 知识库文件
    tools:            # 可用工具
      - lookup_package_price
      - calculate_dive_cost
```

### scripts/generate.js

核心函数：

- `parseSections(md)` — 解析 MD 为结构化段落（标题 + 表格 + 内容）
- `buildPriceData(files)` — 从所有 MD 构建 `data.json`
- `buildPricePrompt(data)` — 生成 `system-prompt.md`（/price）
- `buildInfoPrompt(files)` — 生成 `system-prompt.md`（/info）
- `parseSurcharges(code)` — 解析航空附加费（含复合日期）
- `parseNum(s)` — 解析含粗体标记的数字（如 `**4,050**`）

### knowledge/price/data.json

由 `generate.js` 生成的数据结构，price-tools.js 动态加载。

## 切换 LLM 提供商

修改 `src/llm.js`：

**Claude API (Anthropic)**：
```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: messages.find(m => m.role === 'system')?.content,
    messages: messages.filter(m => m.role !== 'system'),
    tools: tools,  // 格式需适配 Anthropic
  }),
});
```

**OpenAI**：
```javascript
// 当前已兼容，只需改 BASE_URL 和 MODEL
DEEPSEEK_BASE_URL=https://api.openai.com/v1
DEEPSEEK_MODEL=gpt-4o
```

## 调试

### 查看 LLM 原始输出

在 `src/routes/chat.js` 的 `handleChat` 函数中加日志：

```javascript
console.log('LLM response:', JSON.stringify(response.choices[0].message, null, 2));
```

### 查看 Tool 调用

```javascript
console.log('Tool calls:', JSON.stringify(assistantMessage.tool_calls, null, 2));
```

### 单独测试 generate.js

```bash
node -e "
import('./scripts/generate.js').then(m => m.main());
"
```

## 部署到服务器

```bash
# 在本地构建
cd /Users/jerry/AIWorkspace/project-009-kb-chat
tar --exclude='node_modules' --exclude='.git' -czf kb-chat.tar.gz .

# 上传到服务器
scp kb-chat.tar.gz root@your-server:/data/

# 在服务器上
cd /data
tar -xzf kb-chat.tar.gz -C kb-chat
cd kb-chat
npm install --production
cp .env.example .env  # 填入 API Key
node src/server.js     # 或使用 pm2/systemd
```
