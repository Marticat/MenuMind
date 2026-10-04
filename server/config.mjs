import 'dotenv/config';
export function loadConfig(env = process.env) {
  const provider = env.LLM_PROVIDER || 'template';
  if (!['template', 'openai-compatible'].includes(provider))
    throw new Error('LLM_PROVIDER must be template or openai-compatible');
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 8500);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 9000)
    throw new Error('LLM_TIMEOUT_MS must be between 100 and 9000');
  const reasoningEffort = env.LLM_REASONING_EFFORT?.trim() || undefined;
  if (
    reasoningEffort &&
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)
  )
    throw new Error('Unsupported LLM_REASONING_EFFORT');
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const production = env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://'))
    throw new Error('APP_ORIGIN must use HTTPS in production');
  const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const parsed = new URL(baseUrl);
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
      baseUrl,
      apiKey: env.LLM_API_KEY || '',
      model: env.LLM_MODEL || '',
      reasoningEffort,
      timeoutMs,
    },
  };
}
