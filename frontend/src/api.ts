import type { Recipe, Result, Settings, Tone } from './model';

export type Tag = {
  id: string;
  label: string;
  kind: string;
  evidence?: { field: string; text: string };
  confirmed?: boolean;
};
export type User = { id: string; email: string; name: string; createdAt: string };
export type Profile = {
  restaurantName: string;
  cuisine: string;
  brandInstructions: string;
  language: 'ru' | 'kk';
  tone: Tone;
  preferredTags: string[];
  avoidedTags: string[];
  settings: Settings;
};
export type Workspace = {
  user: User;
  profile: Profile;
  recipes: Recipe[];
  result: Result | null;
  provider: string;
};
export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  token?: string;
};
let csrfToken = '';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      signal:
        options.signal ??
        AbortSignal.timeout(
          options.method === 'POST' && ['/generations', '/description-sets'].includes(path)
            ? 185_000
            : 12_000,
        ),
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Сервер не отвечает. Проверьте подключение и повторите запрос.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('menumind:unauthorized'));
    throw new ApiError(response.status, data?.error?.message ?? 'Не удалось выполнить запрос.');
  }
  if (data?.csrfToken) csrfToken = data.csrfToken;
  return data as T;
}
export const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие.';
export function clearSession() {
  csrfToken = '';
}
