export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, `${label} не найден`);
  return value;
}

export function parseOptionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'Элемент не найден');
  return value;
}

export function parseTitle(value: unknown, max: number, empty: string, tooLong: string) {
  if (typeof value !== 'string') throw new HttpError(400, empty);
  const title = value.trim();
  if (!title) throw new HttpError(400, empty);
  if (title.length > max) throw new HttpError(400, tooLong);
  return title;
}
