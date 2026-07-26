/**
 * 调用 DeepSeek Chat API（OpenAI 兼容格式）
 * 支持 function calling
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const FETCH_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '50000', 10); // 默认 50s，小于前端 60s

export async function chat(messages, { tools } = {}) {
  const body = {
    model: MODEL,
    messages,
    temperature: 0.1,  // 低温度保证价格计算准确
    max_tokens: 2048,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
