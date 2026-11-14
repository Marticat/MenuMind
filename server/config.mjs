import 'dotenv/config';
import { localModelManifest } from './local-lora.mjs';
export function loadConfig(env = process.env) {
  const provider = env.LLM_PROVIDER || 'template';
  if (!['template', 'openai-compatible', 'local-lora'].includes(provider))
    throw new Error('LLM_PROVIDER must be template, local-lora or openai-compatible');
  const local = provider === 'local-lora';
  const timeoutMs = Number(
    local ? env.LOCAL_LORA_TIMEOUT_MS || 120000 : env.LLM_TIMEOUT_MS || 8500,
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > (local ? 180000 : 9000))
    throw new Error(
      local
        ? 'LOCAL_LORA_TIMEOUT_MS must be between 100 and 180000'
        : 'LLM_TIMEOUT_MS must be between 100 and 9000',
    );
  const reasoningEffort = local ? undefined : env.LLM_REASONING_EFFORT?.trim() || undefined;
  if (
    reasoningEffort &&
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)
  )
    throw new Error('Unsupported LLM_REASONING_EFFORT');
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const production = env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://'))
    throw new Error('APP_ORIGIN must use HTTPS in production');
  const baseUrl = local
    ? env.LOCAL_LORA_URL || 'http://127.0.0.1:8008'
    : env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const parsed = new URL(baseUrl);
  if (
    local &&
    (parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash)
  )
    throw new Error('LOCAL_LORA_URL must be a loopback HTTP origin, e.g. http://127.0.0.1:8008');
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('LLM_BASE_URL must be HTTP(S)');
  if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
    throw new Error('Remote LLM_BASE_URL must use HTTPS');
  return {
    port: Number(env.PORT || 3001),
    host: env.HOST || '127.0.0.1',
    databasePath: env.DATABASE_PATH || './data/menumind.sqlite',
    origin,
    production,
    trustProxy: env.TRUST_PROXY === '1',
    llm: {
      provider,
      baseUrl: local ? parsed.origin : baseUrl,
      apiKey: local ? '' : env.LLM_API_KEY || '',
      model: local ? localModelManifest.model_version : env.LLM_MODEL || '',
      reasoningEffort,
      timeoutMs,
    },
  };
}
