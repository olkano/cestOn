import type { ApiEnvelope, ApiFailure } from '../../../packages/contracts/src/http.js';
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
let csrf = '';
export function sessionCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method: options.method ?? 'GET', credentials: 'same-origin', ...(options.signal ? { signal: options.signal } : {}), cache: 'no-store', headers: { 'X-ceston-protocol': '1', ...(options.body !== undefined && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) }, ...(options.body !== undefined ? { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) } : {}) });
  const envelope = await response.json() as ApiEnvelope<T> | ApiFailure;
  if (!response.ok || 'error' in envelope) { const error = 'error' in envelope ? envelope.error : { code: 'request_failed', message: 'The request failed.' }; throw new ApiError(response.status, error.code, error.message); }
  return envelope.data;
}
