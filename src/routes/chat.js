/**
 * 通用对话路由 — 根据 URL path 匹配知识库
 * POST /price  → 报价知识库
 * POST /info   → 信息知识库
 */

import config from '../config.js';
import { chat } from '../llm.js';
import { lookupPackagePrice, executeLookupPackagePrice, calculateDiveCost, executeCalculateDiveCost } from '../lib/price-tools.js';

// 工具注册表：name → { definition, execute }
const TOOL_REGISTRY = {
  lookup_package_price: { definition: lookupPackagePrice, execute: executeLookupPackagePrice },
  calculate_dive_cost: { definition: calculateDiveCost, execute: executeCalculateDiveCost },
};

/**
 * 创建 Express 路由，匹配所有已配置的知识库路径
 */
export function createChatRouter() {
  const router = (req, res) => {
    handleChat(req, res);
  };
  return router;
}

async function handleChat(req, res) {
  const routePath = req.path; // e.g., /price or /info
  const routeConfig = config.routes[routePath];

  if (!routeConfig) {
    return res.status(404).json({ error: `Unknown route: ${routePath}` });
  }

  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) is required' });
  }

  // 构建 system prompt
  const systemPrompt = routeConfig.systemPrompt + `
---
当前日期：2026年7月19日。用户在${routePath}路由下提问。`;

  // 构建工具列表
  const toolNames = routeConfig.tools || [];
  const tools = toolNames.map(name => TOOL_REGISTRY[name]?.definition).filter(Boolean);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  try {
    // 第一轮：发送给 LLM，可能触发 function calling
    let response = await chat(messages, { tools: tools.length > 0 ? tools : undefined });
    let assistantMessage = response.choices[0].message;

    // 处理 function calling 循环
    let loopCount = 0;
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < 5) {
      loopCount++;

      // 执行 tool calls
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

      // 将结果追加到对话中
      messages.push(assistantMessage);
      messages.push(...toolResults);

      // 继续对话
      response = await chat(messages, { tools: tools.length > 0 ? tools : undefined });
      assistantMessage = response.choices[0].message;
    }

    // 返回最终回答
    res.json({
      route: routePath,
      kb: routeConfig.name,
      reply: assistantMessage.content,
    });
  } catch (err) {
    console.error(`[${routePath}]`, err.message);
    res.status(502).json({ error: `LLM error: ${err.message}` });
  }
}
