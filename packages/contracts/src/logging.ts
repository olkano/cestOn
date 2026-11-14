const allowed = new Set(['requestId', 'operation', 'durationMs', 'result', 'count', 'code']);
export function sanitizeLog(input: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && (typeof value === 'number' || (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value))))) as Record<string, string | number>;
}
export function redactText(text: string): string {
  return text.slice(0, 32768).replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g, '[redacted]').replace(/(?:[A-Z]:\\Users\\[^\s\\]+|\/home\/[^\s/]+)/gi, '[local-home]');
}
