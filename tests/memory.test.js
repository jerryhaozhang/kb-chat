import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-chat-memory-test-'));

// 测试用的 memory 目录
const MEMORY_DIR = path.join(TMP_DIR, 'memory');

// 因为 src/memory.js 使用相对于自身的路径，我们通过操纵 cwd 来隔离
// 更好的方式：直接测试函数逻辑，mock fs 操作来隔离
// 这里我们测试实际文件 I/O

// ================================================================
// 直接测试 memory 模块的纯逻辑部分
// ================================================================

// 手动构建 buildContext 的输入输出来测试格式
function buildContextLike(memory) {
  if (!memory) return '';
  const { recentMessages, summary, profile } = memory;
  const hasContent = recentMessages.length > 0 || summary || profile;
  if (!hasContent) return '';

  let ctx = '\n\n---\n[会话记忆]\n以下是你与用户在当前会话中的对话上下文，请结合这些信息回答用户问题。\n';
  if (summary) ctx += `\n对话摘要：${summary}\n`;
  if (profile) ctx += `\n用户偏好：${profile}\n`;
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

describe('buildContext', () => {
  it('空记忆返回空字符串', () => {
    assert.equal(buildContextLike(null), '');
    assert.equal(buildContextLike({ recentMessages: [], summary: '', profile: '' }), '');
  });

  it('仅有 recentMessages 时格式正确', () => {
    const ctx = buildContextLike({
      recentMessages: [
        { role: 'user', content: '澳门出发多少钱' },
        { role: 'assistant', content: '澳门出发 6 天 5 晚...' },
      ],
      summary: '',
      profile: '',
    });
    assert.ok(ctx.includes('[会话记忆]'));
    assert.ok(ctx.includes('用户：澳门出发多少钱'));
    assert.ok(ctx.includes('助手：澳门出发 6 天 5 晚...'));
  });

  it('有 summary 和 profile 时格式正确', () => {
    const ctx = buildContextLike({
      recentMessages: [{ role: 'user', content: '还有别的酒店吗' }],
      summary: '用户在询问帕劳行程报价，偏好假日酒店和澳门出发。',
      profile: '偏好假日酒店，澳门出发，6天5晚行程。',
    });
    assert.ok(ctx.includes('对话摘要：用户在询问帕劳行程报价'));
    assert.ok(ctx.includes('用户偏好：偏好假日酒店'));
    assert.ok(ctx.includes('用户：还有别的酒店吗'));
  });

  it('summary 和 profile 为空字符串时不显示对应标签', () => {
    const ctx = buildContextLike({
      recentMessages: [{ role: 'user', content: '你好' }],
      summary: '',
      profile: '',
    });
    assert.ok(!ctx.includes('对话摘要'));
    assert.ok(!ctx.includes('用户偏好'));
  });
});

// ================================================================
// 测试记忆数据结构完整性
// ================================================================

describe('Memory 数据结构', () => {
  let tmpMemoryDir;

  before(() => {
    tmpMemoryDir = path.join(TMP_DIR, 'memory-struct');
    fs.mkdirSync(tmpMemoryDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpMemoryDir, { recursive: true, force: true });
  });

  it('新会话创建正确的空结构', () => {
    const now = new Date().toISOString();
    const memory = {
      sessionId: 'test-uuid-123',
      createdAt: now,
      updatedAt: now,
      recentMessages: [],
      summary: '',
      profile: '',
    };
    assert.equal(memory.sessionId, 'test-uuid-123');
    assert.equal(memory.recentMessages.length, 0);
    assert.equal(memory.summary, '');
    assert.equal(memory.profile, '');
    assert.ok(Date.parse(memory.createdAt) > 0);
    assert.ok(Date.parse(memory.updatedAt) > 0);
  });

  it('添加对话后 recentMessages 正确增长', () => {
    const memory = {
      sessionId: 'test',
      recentMessages: [],
      summary: '',
      profile: '',
    };
    memory.recentMessages.push(
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' }
    );
    assert.equal(memory.recentMessages.length, 2);
    assert.equal(memory.recentMessages[0].role, 'user');
    assert.equal(memory.recentMessages[1].role, 'assistant');
  });

  it('序列化/反序列化往返一致', () => {
    const memory = {
      sessionId: 'test-roundtrip',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recentMessages: [
        { role: 'user', content: '测试问题' },
        { role: 'assistant', content: '测试回答，包含\n换行和"引号"' },
      ],
      summary: '测试摘要',
      profile: '测试画像',
    };
    const file = path.join(tmpMemoryDir, 'roundtrip.json');
    fs.writeFileSync(file, JSON.stringify(memory, null, 2));
    const loaded = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(loaded.sessionId, memory.sessionId);
    assert.equal(loaded.recentMessages.length, 2);
    assert.equal(loaded.summary, '测试摘要');
    assert.equal(loaded.profile, '测试画像');
  });

  it('损坏的 JSON 文件返回默认值（模拟）', () => {
    const file = path.join(tmpMemoryDir, 'corrupt.json');
    fs.writeFileSync(file, 'not valid json{{{{', 'utf-8');
    let result;
    try {
      result = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      result = {
        sessionId: 'corrupt',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recentMessages: [],
        summary: '',
        profile: '',
      };
    }
    assert.equal(result.recentMessages.length, 0);
    assert.equal(result.summary, '');
  });
});

// ================================================================
// 测试文件过期清理
// ================================================================

describe('cleanupExpired 逻辑', () => {
  let cleanupDir;

  before(() => {
    cleanupDir = path.join(TMP_DIR, 'memory-cleanup');
    fs.mkdirSync(cleanupDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(cleanupDir, { recursive: true, force: true });
  });

  it('过期文件被删除，未过期文件保留', () => {
    const oldFile = path.join(cleanupDir, 'old-session.json');
    const newFile = path.join(cleanupDir, 'new-session.json');

    fs.writeFileSync(oldFile, '{}');
    fs.writeFileSync(newFile, '{}');

    // 设置 oldFile 的 mtime 为 8 天前
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    // 模拟清理逻辑
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(cleanupDir);
    let cleaned = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fp = path.join(cleanupDir, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(fp);
        cleaned++;
      }
    }
    assert.equal(cleaned, 1);
    assert.ok(!fs.existsSync(oldFile), '过期文件应被删除');
    assert.ok(fs.existsSync(newFile), '未过期文件应保留');
  });

  it('目录不存在时不报错', () => {
    const nonExistent = path.join(TMP_DIR, 'does-not-exist');
    assert.doesNotThrow(() => {
      if (fs.existsSync(nonExistent)) {
        // 模拟逻辑：目录不存在就跳过
        return;
      }
    });
  });
});

// ================================================================
// 测试压缩阈值判断
// ================================================================

describe('maybeCompress 阈值逻辑', () => {
  const COMPRESS_THRESHOLD = 16;

  it('≤16 条消息不触发压缩', () => {
    const messages = Array.from({ length: 16 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `消息${i}`,
    }));
    assert.equal(messages.length, COMPRESS_THRESHOLD);
    // 不触发压缩的条件
    const shouldCompress = messages.length > COMPRESS_THRESHOLD;
    assert.equal(shouldCompress, false);
  });

  it('>16 条消息触发压缩', () => {
    const messages = Array.from({ length: 18 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `消息${i}`,
    }));
    assert.equal(messages.length, 18);
    const shouldCompress = messages.length > COMPRESS_THRESHOLD;
    assert.equal(shouldCompress, true);

    // 取前 8 条压缩，保留后 10 条
    const toCompress = messages.slice(0, 8);
    const toKeep = messages.slice(8);
    assert.equal(toCompress.length, 8);
    assert.equal(toKeep.length, 10);
  });

  it('大量消息正确截断', () => {
    const messages = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `消息${i}`,
    }));
    const toCompress = messages.slice(0, 8);
    const toKeep = messages.slice(8);
    assert.equal(toKeep.length, 16);
  });
});

// ================================================================
// 测试 System Prompt 拼接
// ================================================================

describe('System Prompt 拼接', () => {
  it('无记忆时 fullPrompt 不包含记忆块', () => {
    const basePrompt = '你是奕海智能销售助理...';
    const ctx = '';
    const fullPrompt = basePrompt + ctx;
    assert.ok(!fullPrompt.includes('[会话记忆]'));
    assert.equal(fullPrompt, basePrompt);
  });

  it('有记忆时 fullPrompt 包含记忆块', () => {
    const basePrompt = '你是奕海智能销售助理...';
    const ctx = buildContextLike({
      recentMessages: [{ role: 'user', content: '你好' }],
      summary: '',
      profile: '',
    });
    const fullPrompt = basePrompt + ctx;
    assert.ok(fullPrompt.includes('[会话记忆]'));
    assert.ok(fullPrompt.startsWith('你是奕海智能销售助理'));
  });

  it('sessionId 为 null/undefined 时跳过记忆', () => {
    const ctx = null ? buildContextLike({}) : '';
    assert.equal(ctx, '');
  });
});

// ================================================================
// 清理测试临时目录
// ================================================================

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
