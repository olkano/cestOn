const minute = 60000;
const hour = 60 * minute;
const day = 24 * hour;
const bands = [
  [7 * day, 'week'], [4 * day, 'four-days'], [2 * day, 'two-days'], [day, 'day'],
  [12 * hour, 'today'], [5 * hour, 'half-day'], [hour, 'hours'], [0, 'recent'],
] as const;

export function chatRecency(iso: string, now: number) {
  const age = Math.max(0, now - Date.parse(iso));
  const tier = bands.find(([minimum]) => age >= minimum)?.[1] ?? 'week';
  if (!Number.isFinite(age)) return { tier, label:'Time unknown' };
  if (age < minute) return { tier, label:'Just now' };
  if (age < hour) return { tier, label:Math.floor(age / minute) + ' min ago' };
  if (age < day) return { tier, label:Math.floor(age / hour) + ' hr ago' };
  const days = Math.floor(age / day);
  return { tier, label:days + (days === 1 ? ' day ago' : ' days ago') };
}
