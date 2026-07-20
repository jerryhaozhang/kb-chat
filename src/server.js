import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { createChatRouter } from './routes/chat.js';
import { chat } from './llm.js';
import { lookupPackagePrice, executeLookupPackagePrice, calculateDiveCost, executeCalculateDiveCost } from './lib/price-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// CORS — 允许所有来源
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 静态文件服务（放在路由之前，使 index.html 优先匹配 /）
app.use(express.static(path.join(__dirname, '../public')));

// 工具注册表：name → { definition, execute }
const TOOL_REGISTRY = {
  lookup_package_price: { definition: lookupPackagePrice, execute: executeLookupPackagePrice },
  calculate_dive_cost: { definition: calculateDiveCost, execute: executeCalculateDiveCost },
};

// 健康检查
app.get('/health', (_req, res) => res.json({ status: 'ok', routes: Object.keys(config.routes) }));

// 路由列表（避免与静态文件 / 冲突，改用 /api/routes）
app.get('/api/routes', (_req, res) => {
  const routes = Object.entries(config.routes).map(([routePath, cfg]) => ({
    path: routePath,
    name: cfg.name,
    description: cfg.description,
    tools: cfg.tools,
  }));
  res.json({ service: 'KB Chat', routes });
});

// ============================================================================
// POST /chat — 合并所有知识库的统一对话端点
// ============================================================================
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    // 合并所有路由的 system prompt
    const routeConfigs = Object.values(config.routes);
    const combinedPrompt = routeConfigs
      .map(r => r.systemPrompt)
      .filter(Boolean)
      .join('\n\n---\n\n');

    const fullPrompt = `你是奕海智能销售助理，整合了报价查询和旅游信息两大知识库，帮助用户查询潜水行程相关信息。

${combinedPrompt}

---
当前日期：2026年7月20日。请根据用户问题，综合以上知识库信息提供准确回答。注意：回答中不要出现"帕劳旅游"字样，用"潜水行程"替代。`;

    // 合并所有路由的 tools（去重）
    const allToolNames = [...new Set(routeConfigs.flatMap(r => r.tools || []))];
    const tools = allToolNames.map(name => TOOL_REGISTRY[name]?.definition).filter(Boolean);

    const messages = [
      { role: 'system', content: fullPrompt },
      { role: 'user', content: message.trim() },
    ];

    // LLM function calling 循环
    let response = await chat(messages, { tools: tools.length > 0 ? tools : undefined });
    let assistantMessage = response.choices[0].message;

    let loopCount = 0;
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < 5) {
      loopCount++;
      const toolResults = assistantMessage.tool_calls.map(tc => {
        const tool = TOOL_REGISTRY[tc.function.name];
        if (!tool) return { tool_call_id: tc.id, role: 'tool', content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }) };
        try {
          const args = JSON.parse(tc.function.arguments);
          const result = tool.execute(args);
          return { tool_call_id: tc.id, role: 'tool', content: JSON.stringify(result) };
        } catch (e) {
          return { tool_call_id: tc.id, role: 'tool', content: JSON.stringify({ error: e.message }) };
        }
      });
      messages.push(assistantMessage);
      messages.push(...toolResults);
      response = await chat(messages, { tools: tools.length > 0 ? tools : undefined });
      assistantMessage = response.choices[0].message;
    }

    res.json({
      route: '/chat',
      kb: '奕海智能销售助理',
      reply: assistantMessage.content || '',
    });
  } catch (err) {
    console.error('[chat]', err.message);
    res.status(502).json({ error: `LLM error: ${err.message}` });
  }
});

// 动态注册原有知识库路由（/price、/info）
const chatRouter = createChatRouter();
for (const routePath of Object.keys(config.routes)) {
  app.post(routePath, chatRouter);
  console.log(`  POST ${routePath} → ${config.routes[routePath].name}`);
}

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const port = config.server.port;
app.listen(port, () => {
  console.log(`\n🧠 KB Chat 启动: http://localhost:${port}`);
  console.log(`   Chat 页面: http://localhost:${port}/\n`);
});
