export class AuthError extends Error {
  constructor() {
    super('Нужен вход');
  }
}

export class ApiError extends Error {}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('Не удалось сохранить');
  }
  if (response.status === 401) throw new AuthError();
  let payload: { error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new ApiError(payload.error || 'Не удалось сохранить');
  return payload as T;
}
