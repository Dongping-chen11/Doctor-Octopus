import type {
  Candidate, Clinic, MatchResult, Patient, Provider, Rejected, RuleId, Settings, ShowModel, Slot, WavePlan, WavePlanEntry,
} from './types';

export const DEFAULT_SETTINGS: Settings = {
  weights: { fit: 0.4, need: 0.3, wait: 0.3 },
  fatigueCap: 5,
  crossClinic: true,
  travelBuffer: 15,
};

export interface Context {
  clinics: Record<string, Clinic>;
  providers: Record<string, Provider>;
  model: ShowModel;
  settings: Settings;
  /** patients already booked at the slot's time (cannot double book) */
  busy?: Set<string>;
  /** replay only: per-patient override for "free today" */
  freeToday?: (p: Patient) => boolean;
  /** extra offers already sent this week, tracked by the live demo or the replay */
  extraOffers?: Map<string, number>;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** City driving estimate: 1.4x straight line at ~32 km/h, plus 5 minutes to park. */
export const travelMinutes = (km: number) => Math.round(km * 1.4 * (60 / 32) + 5);

export function windowFor(hour: number): 'morning' | 'afternoon' | 'evening' {
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

/** P(show) from the logistic model trained on the clinics' real outcomes. */
export function showProbability(model: ShowModel, p: Patient, slot: Slot, minutesLeft: number) {
  const { a, b } = model.prior;
  const x: Record<string, number> = {
    prior_rate: (p.history.cancels + a) / (p.history.visits + a + b),
    online: p.history.online,
    log_lead: Math.log1p(Math.max(0, minutesLeft) / 1440),
    first: 0,
    evening: slot.hour >= 17 ? 1 : 0,
    morning: slot.hour < 11 ? 1 : 0,
    saturday: slot.dow === 5 ? 1 : 0,
    cat_massage: p.need.category === 'massage' ? 1 : 0,
    cat_chiro: p.need.category === 'chiro' ? 1 : 0,
    cat_aesthetics: p.need.category === 'aesthetics' ? 1 : 0,
    cat_acupuncture: p.need.category === 'acupuncture' ? 1 : 0,
    insurance: p.need.payer !== 'private' ? 1 : 0,
  };
  let z = model.intercept;
  for (const f of model.features) z += (model.coef[f] ?? 0) * (x[f] ?? 0);
  return 1 - sigmoid(z);
}

const FUNNEL: { rule: RuleId; label: string }[] = [
  { rule: 'optin', label: 'Opted in to offers' },
  { rule: 'service', label: 'Needs a service this provider gives' },
  { rule: 'duration', label: 'Fits in the slot length' },
  { rule: 'provider', label: 'Provider is acceptable' },
  { rule: 'clinic', label: 'Clinic is acceptable' },
  { rule: 'busy', label: 'Not already booked then' },
  { rule: 'available', label: 'Free at that time' },
  { rule: 'reach', label: 'Can get there in time' },
  { rule: 'fatigue', label: 'Under the weekly offer cap' },
];

/** Hard filters, then scoring and ranking for one open slot. */
export function matchSlot(slot: Slot, patients: Patient[], now: number, ctx: Context): MatchResult {
  const provider = ctx.providers[slot.provider];
  const clinic = ctx.clinics[slot.clinic];
  const minutesLeft = slot.start - now;
  const { settings } = ctx;
  const win = windowFor(slot.hour);
  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];

  for (const p of patients) {
    const km = distanceKm(p.lat, p.lng, clinic.lat, clinic.lng);
    const travel = travelMinutes(km);
    const free = ctx.freeToday ? ctx.freeToday(p) : p.freeToday;
    const sameProvider = p.provider === slot.provider;
    const offers = p.offersThisWeek + (ctx.extraOffers?.get(p.id) ?? 0);

    const fail = (rule: RuleId, detail: string) => rejected.push({ patient: p, rule, detail });
    if (p.optedOut) { fail('optin', 'Opted out of short-notice offers'); continue; }
    if (!provider.categories.includes(p.need.category)) { fail('service', `Needs ${p.need.category}, provider gives ${provider.categories.join(', ')}`); continue; }
    if (p.need.duration > slot.duration) { fail('duration', `Needs ${p.need.duration} min, slot is ${slot.duration} min`); continue; }
    if (!sameProvider && !p.acceptsOtherProviders) { fail('provider', 'Only wants their own provider'); continue; }
    if (p.homeClinic !== slot.clinic && !settings.crossClinic) { fail('clinic', 'Goes to the other clinic'); continue; }
    if (ctx.busy?.has(p.id)) { fail('busy', 'Already booked at that time'); continue; }
    const windowOk = p.windows[win] && p.days.includes(slot.dow);
    if (!(free || (p.flexMode && windowOk))) {
      fail('available', !p.flexMode ? 'Flex mode off, not marked free today' : `Not usually free ${win}s on this day`);
      continue;
    }
    if (travel + settings.travelBuffer > minutesLeft) { fail('reach', `${travel} min away, ${Math.max(0, Math.round(minutesLeft))} min left`); continue; }
    if (offers >= settings.fatigueCap) { fail('fatigue', `Already had ${offers} offers this week`); continue; }

    // ---- soft scoring ----
    const langMatch = p.language !== 'English' && provider.languages.includes(p.language);
    const daysSooner = p.nextBookingInDays ?? 0;
    const waiting = p.waitingDays ?? 0;

    let z = -1.3;
    z += free ? 1.6 : 0;
    z += p.flexMode && windowOk ? 0.6 : 0;
    z += 2.2 * (p.offerAcceptRate - 0.4);
    z -= 0.05 * travel;
    z += waiting ? 0.5 + Math.min(waiting, 21) * 0.02 : Math.min(daysSooner, 21) * 0.05;
    z += sameProvider ? 0.4 : 0;
    z -= 0.25 * offers;
    z -= minutesLeft < 90 ? 0.5 : 0;
    const pAccept = sigmoid(z);
    const pShow = showProbability(ctx.model, p, slot, minutesLeft);

    const fit = 0.4 * (sameProvider ? 1 : 0) + 0.3 * (windowOk || free ? 1 : 0) + 0.2 * (langMatch ? 1 : 0) + 0.1 * (travel <= 15 ? 1 : 0);
    const need = p.acute ? 1 : p.need.payer !== 'private' ? 0.6 : 0.3;
    const wait = waiting ? Math.min(1, waiting / 21) : Math.min(1, daysSooner / 21);
    const w = settings.weights;
    const wsum = w.fit + w.need + w.wait || 1;
    const value = (w.fit * fit + w.need * need + w.wait * wait) / wsum;
    const score = pAccept * pShow * value;

    const reasons: string[] = [];
    if (free) reasons.push('Free today');
    else if (p.flexMode) reasons.push(`Flex: ${win}s`);
    if (sameProvider) reasons.push('Same provider');
    reasons.push(`${travel} min away`);
    if (waiting) reasons.push(`Waitlist ${waiting} d`);
    else if (daysSooner) reasons.push(`${daysSooner} d sooner`);
    if (p.acute) reasons.push('Acute');
    if (p.need.payer !== 'private') reasons.push(`${p.need.payer} plan`);
    if (langMatch) reasons.push(`Speaks ${p.language}`);
    reasons.push(`${Math.round(pShow * 100)}% show`);
    if (p.homeClinic !== slot.clinic) reasons.push('Other clinic');

    candidates.push({ patient: p, travelMin: travel, distanceKm: km, pAccept, pShow, fit, need, wait, value, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  let remaining = patients.length;
  const funnel: MatchResult['funnel'] = [{ rule: 'pool', label: 'Active patients', remaining }];
  for (const f of FUNNEL) {
    remaining -= rejected.filter(r => r.rule === f.rule).length;
    funnel.push({ rule: f.rule, label: f.label, remaining });
  }
  return { candidates, rejected, funnel };
}

/** Wave size target and hold timer depend on how close the slot is. */
export function urgency(minutesLeft: number) {
  if (minutesLeft > 24 * 60) return { target: 0.6, timerMin: 30, channel: 'App push' };
  if (minutesLeft > 6 * 60) return { target: 0.75, timerMin: 15, channel: 'Push, then SMS' };
  if (minutesLeft > 2 * 60) return { target: 0.85, timerMin: 10, channel: 'Push and SMS' };
  return { target: 0.95, timerMin: 5, channel: 'Push, SMS, call list' };
}

/**
 * Plan offer waves: each wave adds candidates in rank order until the chance that
 * at least one accepts reaches the target. Later waves only include people who can
 * still reach the clinic by then.
 */
export function planWaves(candidates: Candidate[], minutesLeft: number, settings: Settings, maxWaves = 8, maxPerWave = 8): WavePlan {
  const { target, timerMin } = urgency(minutesLeft);
  const waves: WavePlanEntry[] = [];
  let i = 0;
  let pNone = 1;
  let offers = 0;
  let pReach = 1; // P(no one accepted in earlier waves)
  for (let w = 0; w < maxWaves && i < candidates.length; w++) {
    const startsIn = w * timerMin;
    const left = minutesLeft - startsIn;
    const members: Candidate[] = [];
    let wNone = 1;
    while (i < candidates.length && members.length < maxPerWave) {
      const c = candidates[i++];
      if (c.travelMin + settings.travelBuffer > left) continue;
      members.push(c);
      wNone *= 1 - c.pAccept;
      if (1 - wNone >= target) break;
    }
    if (!members.length) break;
    offers += pReach * members.length;
    pReach *= wNone;
    pNone *= wNone;
    waves.push({ index: w + 1, candidates: members, timerMin, pAny: 1 - wNone, startsInMin: startsIn });
  }
  return { waves, target, timerMin, pFill: 1 - pNone, expectedOffers: offers };
}

export interface BaselineBucket { label: string; lo: number; hi: number; rate: number; n: number }

/** What the clinics achieved by hand, from the real exports. */
export function manualBaseline(baseline: BaselineBucket[], minutesLeft: number) {
  const h = minutesLeft / 60;
  return baseline.find(b => h >= b.lo && h < b.hi) ?? baseline[baseline.length - 1];
}
