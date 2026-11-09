import { baseline, clinicById, history, model, patients, providerById, dataRange } from '../src/engine/data';
import { DEFAULT_SETTINGS } from '../src/engine/match';
import { replay } from '../src/engine/replay';
const ctx = { clinics: clinicById, providers: providerById, model, settings: DEFAULT_SETTINGS };
const lost = history.length, cancels = history.filter(h => h.type === 'cancelled').length;
const manual = history.filter(h => h.refilled).length;
const eligible = history.filter(h => !h.refilled && h.type === 'cancelled' && h.leadHours * 60 >= 20).length;
console.log(JSON.stringify({ dataRange, lost, cancels, noShows: lost - cancels, manual, eligible, lostHours: history.reduce((s, h) => s + h.duration / 60, 0), manualHours: history.filter(h => h.refilled).reduce((s, h) => s + h.duration / 60, 0) }));
for (const [name, haircut, waves] of [['conservative', 0.3, 3], ['base', 0.45, 4], ['optimistic', 0.6, 5]] as const) {
  const rs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(seed => replay(history, patients, baseline, ctx, { acceptHaircut: haircut, maxWaves: waves, seed }));
  const avg = (f: (r: typeof rs[0]) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  const extra = rs.map(r => r.engineFilled - r.manualFilled);
  console.log(name, JSON.stringify({
    extra: avg(r => r.engineFilled - r.manualFilled), min: Math.min(...extra), max: Math.max(...extra),
    hours: avg(r => r.hoursRecovered), total: avg(r => r.engineFilled), offers: avg(r => r.offers), opf: avg(r => r.offersPerFill),
    short: avg(r => r.shortNotice.engine), shortN: rs[0].shortNotice.n, shortManual: rs[0].shortNotice.manual, mins: avg(r => r.minutesToFill),
    buckets: rs[0].byBucket.map((b, i) => [b.label, b.n, b.manual, avg(r => r.byBucket[i].engine)]),
    need: rs[0].fillsByNeed,
  }));
}
