import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../config.yaml');

function loadConfig() {
  const raw = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  // 加载每个 route 的 system prompt
  for (const [routePath, route] of Object.entries(raw.routes)) {
    const promptFile = path.resolve(__dirname, '..', route.systemPromptFile);
    if (fs.existsSync(promptFile)) {
      route.systemPrompt = fs.readFileSync(promptFile, 'utf-8');
    } else {
      console.warn(`System prompt file not found: ${promptFile}`);
      route.systemPrompt = '';
    }
  }

  return raw;
}

const config = loadConfig();
export default config;
