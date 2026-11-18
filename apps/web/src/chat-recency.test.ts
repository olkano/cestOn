import { expect, it } from 'vitest';
import { chatRecency } from './chat-recency.js';

it('changes emphasis at each boundary and uses minutes, hours and days', () => {
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const now = Date.parse('2026-11-18T12:00:00Z');
  for (const [age, tier, label] of [
    [0,'recent','Just now'], [14 * minute,'recent','14 min ago'], [hour - 1,'recent','59 min ago'],
    [hour,'hours','1 hr ago'], [5 * hour,'half-day','5 hr ago'], [12 * hour,'today','12 hr ago'],
    [day,'day','1 day ago'], [2 * day,'two-days','2 days ago'], [4 * day,'four-days','4 days ago'],
    [7 * day,'week','7 days ago'],
  ] as const) expect(chatRecency(new Date(now-age).toISOString(),now)).toEqual({ tier,label });
  expect(chatRecency(new Date(now+minute).toISOString(),now).label).toBe('Just now');
});
