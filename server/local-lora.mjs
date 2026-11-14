import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiError } from './schemas.mjs';

export const localModelManifest = JSON.parse(
  readFileSync(new URL('../experiments/lora-study/final_model.json', import.meta.url), 'utf8'),
);
const clean = (max) =>
  z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    .pipe(z.string().min(1).max(max));
const inputSchema = z.object({
  language: z.enum(['ru', 'kk']),
  recipe: z.object({
    name: clean(120),
    ingredients: z.array(clean(80)).min(1).max(12),
    method: clean(120),
  }),
});

// A transport adapter for the frozen website/neutral model, not a four-style prompt.
export async function generateLocalDescription({
  recipe,
  language,
  tone,
  descriptionStyle,
  config,
  limits,
  fetchImpl,
}) {
  if (tone !== 'editorial' || (descriptionStyle && descriptionStyle !== 'concise'))
    throw new ApiError(
      422,
      'LORA_UNSUPPORTED_STYLE',
      'Локальная LoRA поддерживает только нейтральное описание без смены акцента.',
    );
  const parsed = inputSchema.safeParse({
    language,
    recipe: { name: recipe.name, ingredients: recipe.ingredients, method: recipe.method },
  });
  if (!parsed.success)
    throw new ApiError(
      422,
      'LORA_INPUT_INVALID',
      'Для LoRA нужны название и метод до 120 символов, а также 1–12 ингредиентов до 80 символов каждый.',
    );
  let payload;
  try {
    const response = await fetchImpl(`${config.baseUrl}/generate`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parsed.data, channel: 'website', tone: 'neutral', maxLength: 250 }),
    });
    if (response.status === 503)
      throw new ApiError(
        503,
        'LORA_BUSY',
        'Локальная модель занята. Дождитесь завершения предыдущей генерации.',
      );
    if (response.status === 400 || response.status === 413)
      throw new ApiError(
        422,
        'LORA_INPUT_INVALID',
        'LoRA отклонила техкарту. Сократите поля, проверьте состав и способ приготовления.',
      );
    if (response.status === 422)
      throw new ApiError(
        422,
        'LORA_REJECTED',
        'Ответ локальной LoRA не прошёл проверки. Уточните техкарту; шаблонная подмена не выполняется.',
      );
    if (!response.ok)
      throw new ApiError(
        502,
        'LORA_UNAVAILABLE',
        'Локальный сервис LoRA вернул ошибку. Проверьте окно запуска модели.',
      );
    payload = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new ApiError(
        504,
        'LORA_TIMEOUT',
        'Локальная модель не успела ответить. Дождитесь завершения запроса в окне модели перед повтором.',
      );
    if (error instanceof TypeError)
      throw new ApiError(
        503,
        'LORA_UNAVAILABLE',
        'Локальная LoRA недоступна. Запустите serve.py на порту 8008 и повторите запрос.',
      );
    throw new ApiError(502, 'LORA_INVALID_OUTPUT', 'Локальный сервис вернул некорректный ответ.');
  }
  if (
    !payload ||
    payload.model_version !== localModelManifest.model_version ||
    payload.adapter_sha256 !== localModelManifest.adapter_sha256 ||
    payload.base_revision !== localModelManifest.base_revision
  )
    throw new ApiError(
      502,
      'LORA_MODEL_MISMATCH',
      'Версия локальной модели не совпадает с проектом. Обновите проект и перезапустите LoRA.',
    );
  if (
    payload.accepted !== true ||
    typeof payload.description !== 'string' ||
    !payload.description.trim() ||
    payload.description.length > 250 ||
    payload.requires_human_review !== true ||
    payload.validation_version !== 'final-v1' ||
    !Array.isArray(payload.validation_errors) ||
    payload.validation_errors.length
  )
    throw new ApiError(
      502,
      'LORA_INVALID_OUTPUT',
      'Локальный сервис не вернул проверенное описание.',
    );
  if (Object.values(limits).some((limit) => payload.description.length > limit))
    throw new ApiError(
      422,
      'LORA_LENGTH_LIMIT',
      'Описание LoRA длиннее лимита канала. Увеличьте лимит до 250 символов или сократите техкарту. Текст не обрезается.',
    );
  return {
    output: {
      texts: Object.fromEntries(
        ['yandex', 'wolt', 'website', 'print'].map((id) => [id, payload.description]),
      ),
      variant: payload.description,
    },
    localInference: {
      modelVersion: payload.model_version,
      adapterSha256: payload.adapter_sha256,
      baseRevision: payload.base_revision,
      validationVersion: payload.validation_version,
      device: payload.device,
      channelMode: 'shared',
      style: 'neutral',
      deterministic: true,
    },
    providerModel: payload.model_version,
    usage: {
      promptTokens: payload.input_tokens ?? null,
      completionTokens: payload.generated_tokens ?? null,
      totalTokens:
        Number.isInteger(payload.input_tokens) && Number.isInteger(payload.generated_tokens)
          ? payload.input_tokens + payload.generated_tokens
          : null,
      cachedTokens: null,
      reasoningTokens: null,
    },
  };
}
