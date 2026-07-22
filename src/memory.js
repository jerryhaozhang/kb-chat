import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const COMPRESS_THRESHOLD = 16; // 8 rounds = 16 messages

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

export function loadMemory(sessionId) {
  try {
    ensureDir();
    const file = path.join(MEMORY_DIR, `${sessionId}.json`);
    if (!fs.existsSync(file)) {
      return {
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recentMessages: [],
        summary: '',
        profile: '',
      };
    }
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[memory] loadMemory failed for ${sessionId}:`, err.message);
    return {
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recentMessages: [],
      summary: '',
      profile: '',
    };
  }
}

export function saveMemory(sessionId, memory) {
  try {
    ensureDir();
    memory.updatedAt = new Date().toISOString();
    const file = path.join(MEMORY_DIR, `${sessionId}.json`);
    fs.writeFileSync(file, JSON.stringify(memory, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[memory] saveMemory failed for ${sessionId}:`, err.message);
  }
}

async function maybeCompress(memory) {
  if (memory.recentMessages.length <= COMPRESS_THRESHOLD) return memory;

  // 取最早的 8 条消息（4 轮）压缩为摘要
  const toCompress = memory.recentMessages.slice(0, 8);
  const toKeep = memory.recentMessages.slice(8);

  const compressPrompt = `请对以下对话进行压缩，返回严格的JSON格式（不要markdown代码块）：
{"summary":"...", "profile":"..."}

要求：
1. summary: 将对话关键信息压缩为2-3句话摘要。如果已有摘要，合并到已有摘要中。
2. profile: 提取用户偏好，如常问的酒店、日期、人数、出发地等，一句话概括。

已有摘要：${memory.summary || '无'}
已有画像：${memory.profile || '无'}

对话内容：
${toCompress.map(m => `${m.role}: ${m.content}`).join('\n')}`;

  try {
    const response = await chat(
      [{ role: 'user', content: compressPrompt }],
      { temperature: 0 }
    );
    const text = response.choices[0].message.content || '';
    // JSON 可能包裹在 markdown 代码块中，提取第一个 { } 对
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      memory.summary = parsed.summary || memory.summary;
      memory.profile = parsed.profile || memory.profile;
    }
  } catch (err) {
    console.warn('[memory] compress failed:', err.message);
  }

  memory.recentMessages = toKeep;
  return memory;
}

export async function addTurn(sessionId, userMsg, assistantReply) {
  try {
    const memory = loadMemory(sessionId);
    memory.recentMessages.push(
      { role: 'user', content: userMsg },
      { role: 'assistant', content: assistantReply }
    );
    await maybeCompress(memory);
    saveMemory(sessionId, memory);
  } catch (err) {
    console.warn(`[memory] addTurn failed for ${sessionId}:`, err.message);
  }
}

export function buildContext(memory) {
  if (!memory) return '';
  const { recentMessages, summary, profile } = memory;
  const hasContent = recentMessages.length > 0 || summary || profile;
  if (!hasContent) return '';

  let ctx = '\n\n---\n[会话记忆]\n以下是你与用户在当前会话中的对话上下文，请结合这些信息回答用户问题。\n';

  if (summary) {
    ctx += `\n对话摘要：${summary}\n`;
  }
  if (profile) {
    ctx += `\n用户偏好：${profile}\n`;
  }
  if (recentMessages.length > 0) {
    ctx += '\n最近对话记录：\n';
    for (const m of recentMessages) {
      const label = m.role === 'user' ? '用户' : '助手';
      ctx += `${label}：${m.content}\n`;
    }
  }
  ctx += '---';
  return ctx;
}

export function cleanupExpired(maxAgeDays = 7) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) return;
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(MEMORY_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(MEMORY_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[memory] cleaned up expired: ${file}`);
      }
    }
  } catch (err) {
    console.warn('[memory] cleanupExpired failed:', err.message);
  }
}
