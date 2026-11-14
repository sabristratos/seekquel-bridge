import { REQUEST_TIMEOUT_MS } from './constants.js';

export type Fetch = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly errorType: string | null,
    message: string,
  ) {
    super(message);
  }
}

export class UnreachableError extends Error {
  constructor(
    readonly service: string,
    cause: unknown,
  ) {
    super(`${service} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface JsonRequest {
  readonly service: string;
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly url: string;
  readonly token?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly form?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export async function requestJson(fetcher: Fetch, request: JsonRequest): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };

  if (request.token !== undefined) {
    headers.Authorization = `Bearer ${request.token}`;
  }

  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  } else if (request.form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  let response: Response;

  try {
    response = await fetcher(request.url, {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.form === undefined ? {} : { body: new URLSearchParams(request.form).toString() }),
    });
  } catch (cause) {
    throw new UnreachableError(request.service, cause);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new HttpError(
      request.service,
      response.status,
      errorType(payload),
      `${request.service} answered ${response.status} to ${request.method} ${new URL(request.url).pathname}`,
    );
  }

  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();

  if (raw === '') {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function errorType(payload: unknown): string | null {
  return asString(field(field(payload, 'error'), 'type'));
}

export function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
