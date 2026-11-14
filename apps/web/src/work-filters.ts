export type WorkFilters = { search: string; state: string; project: string };
const empty: WorkFilters = { search: '', state: '', project: '' };
function key(owner: string) { return `ceston.work-filters:${owner}`; }
export function loadWorkFilters(owner: string): WorkFilters {
  if (!owner) return { ...empty };
  try { const value = JSON.parse(localStorage.getItem(key(owner)) ?? 'null') as { expiresAt: number; filters: WorkFilters } | null; if (!value || value.expiresAt <= Date.now() || !value.filters || typeof value.filters.search !== 'string' || typeof value.filters.state !== 'string' || typeof value.filters.project !== 'string') return { ...empty }; return { search: value.filters.search.slice(0, 160), state: value.filters.state.slice(0, 32), project: value.filters.project.slice(0, 36) }; } catch { return { ...empty }; }
}
export function saveWorkFilters(owner: string, filters: WorkFilters) { if (!owner) return; localStorage.setItem(key(owner), JSON.stringify({ filters, expiresAt: Date.now() + 86400000 })); }
