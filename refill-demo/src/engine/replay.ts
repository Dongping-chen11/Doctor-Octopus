import { matchSlot, planWaves, type BaselineBucket, type Context } from './match';
import type { Category, Patient, Slot } from './types';

export interface HistoryRow {
  clinic: string;
  provider: string;
  category: Category;
  payer: string;
  start: string;
  dow: number;
  hour: number;
  duration: number;
  leadHours: number;
  type: 'cancelled' | 'no_show';
  refilled: boolean;
}

export interface ReplayOptions {
  /** scale P(accept) down to be conservative in the replay */
  acceptHaircut: number;
  maxWaves: number;
  seed: number;
}

export const DEFAULT_REPLAY: ReplayOptions = { acceptHaircut: 0.45, maxWaves: 4, seed: 7 };

export interface BucketResult { label: string; n: number; manual: number; engine: number }

export interface ReplayResult {
  rows: number;
  manualFilled: number;
  engineFilled: number;
  manualHours: number;
  engineHours: number;
  hoursRecovered: number;
  offers: number;
  offersPerFill: number;
  maxOffersPerPatientWeek: number;
  patientsOffered: number;
  byBucket: BucketResult[];
  shortNotice: { n: number; manual: number; engine: number };
  fillsByNeed: { acute: number; insurance: number; waitlist: number; sooner: number };
  minutesToFill: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * Replays last year's real cancellations through the engine, with mock patients.
 * A slot counts as filled if staff refilled it in real life OR the engine fills it
 * (the engine works alongside the front desk, it does not replace it).
 */
export function replay(history: HistoryRow[], patients: Patient[], baseline: BaselineBucket[], ctx: Context, opts: ReplayOptions = DEFAULT_REPLAY): ReplayResult {
  const rand = mulberry32(opts.seed);
  const rows = [...history].sort((a, b) => a.start.localeCompare(b.start));
  const byBucket: BucketResult[] = baseline.map(b => ({ label: b.label, n: 0, manual: 0, engine: 0 }));
  const short = { n: 0, manual: 0, engine: 0 };
  const fills = { acute: 0, insurance: 0, waitlist: 0, sooner: 0 };
  let manualFilled = 0, engineFilled = 0, manualHours = 0, engineHours = 0, offers = 0, maxWeek = 0, fillMinutes = 0, engineOnly = 0;
  const offered = new Set<string>();
  let week = '';
  let extra = new Map<string, number>();

  rows.forEach((h, idx) => {
    const d = new Date(h.start);
    const monday = new Date(d.getTime() - h.dow * 864e5).toISOString().slice(0, 10);
    if (monday !== week) { week = monday; extra = new Map(); }

    const minutesLeft = h.leadHours * 60;
    let filled = h.refilled;
    if (!filled && h.type === 'cancelled' && minutesLeft >= 20) {
      const slot: Slot = { id: `h${idx}`, provider: h.provider, clinic: h.clinic, category: h.category, duration: h.duration, start: 0, dow: h.dow, hour: h.hour };
      const sameDay = minutesLeft < 24 * 60;
      const res = matchSlot(slot, patients, -minutesLeft, {
        ...ctx,
        extraOffers: extra,
        freeToday: p => sameDay && hash(p.id + idx) < (p.flexMode ? 0.2 : 0.04),
      });
      const plan = planWaves(res.candidates, minutesLeft, ctx.settings, opts.maxWaves);
      outer: for (const w of plan.waves) {
        for (const c of w.candidates) {
          offers++;
          offered.add(c.patient.id);
          const n = (extra.get(c.patient.id) ?? 0) + 1;
          extra.set(c.patient.id, n);
          maxWeek = Math.max(maxWeek, c.patient.offersThisWeek + n);
        }
        // first acceptance in the wave wins
        const winner = w.candidates.find(c => rand() < c.pAccept * opts.acceptHaircut);
        if (winner) {
          filled = true;
          engineOnly++;
          fillMinutes += w.startsInMin + w.timerMin * rand();
          const p = winner.patient;
          if (p.acute) fills.acute++;
          else if (p.need.payer !== 'private') fills.insurance++;
          else if (p.waitingDays) fills.waitlist++;
          else fills.sooner++;
          break outer;
        }
      }
    }

    const hours = h.duration / 60;
    if (h.refilled) { manualFilled++; manualHours += hours; }
    if (filled) { engineFilled++; engineHours += hours; }
    const b = baseline.findIndex(x => h.leadHours >= x.lo && h.leadHours < x.hi);
    const bi = b < 0 ? baseline.length - 1 : b;
    byBucket[bi].n++;
    if (h.refilled) byBucket[bi].manual++;
    if (filled) byBucket[bi].engine++;
    if (h.leadHours < 6) {
      short.n++;
      if (h.refilled) short.manual++;
      if (filled) short.engine++;
    }
  });

  return {
    rows: rows.length,
    manualFilled, engineFilled, manualHours, engineHours,
    hoursRecovered: engineHours - manualHours,
    offers,
    offersPerFill: engineOnly ? offers / engineOnly : 0,
    maxOffersPerPatientWeek: maxWeek,
    patientsOffered: offered.size,
    byBucket,
    shortNotice: short,
    fillsByNeed: fills,
    minutesToFill: engineOnly ? fillMinutes / engineOnly : 0,
  };
}
