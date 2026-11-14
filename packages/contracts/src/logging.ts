const allowed = new Set(['requestId', 'operation', 'durationMs', 'result', 'count', 'code']);
export function sanitizeLog(input: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && (typeof value === 'number' || (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value))))) as Record<string, string | number>;
}
export function redactText(text: string): string {
  return text.slice(0, 32768).replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g, '[redacted]').replace(/(?:[A-Z]:\\Users\\[^\s\\]+|\/home\/[^\s/]+)/gi, '[local-home]');
}
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth-limit]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /^(?:token|password|secret|apiKey|authorization|credential)$/i.test(key) ? '[redacted]' : sanitizeValue(item, depth + 1)]));
  return value;
}
