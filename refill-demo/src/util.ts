export function fmtTime(min: number) {
  const m = Math.round(min);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

export function fmtDuration(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const CATEGORY_LABEL: Record<string, string> = {
  physio: 'Physio',
  massage: 'Massage',
  chiro: 'Chiro',
  acupuncture: 'Acupuncture',
  aesthetics: 'Aesthetics',
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo is set on a Tuesday; "in N days" is shown as a date relative to it. */
const DEMO_DATE = new Date('2026-11-10T12:00:00');
export function dayLabel(daysAhead: number) {
  const d = new Date(DEMO_DATE.getTime() + daysAhead * 864e5);
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}
export const DEMO_DAY_LABEL = DEMO_DATE.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
