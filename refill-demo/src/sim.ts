import { matchSlot, planWaves, type Context } from './engine/match';
import { clinicById, model, patientById, patients, providerById, schedule, type Appointment } from './engine/data';
import type { MatchResult, Settings, Slot } from './engine/types';
import type { LogEntry, Offer, Run } from './state';
import { CATEGORY_LABEL, fmtTime } from './util';

export interface Sim {
  clock: number;
  appts: Appointment[];
  runs: Record<string, Run>;
  log: LogEntry[];
  extraOffers: Record<string, number>;
  phonePatientId: string | null;
}

export interface Flags {
  autopilot: boolean;
  scripted: boolean;
}

export const START_CLOCK = 10 * 60;

export function initialSim(): Sim {
  return {
    clock: START_CLOCK,
    appts: schedule.map(a => ({ ...a })),
    runs: {},
    log: [{ at: START_CLOCK, text: 'Front desk opens the day. 6 providers across 2 clinics.', kind: 'info' }],
    extraOffers: {},
    phonePatientId: null,
  };
}

export const slotFromAppt = (a: Appointment): Slot => ({
  id: a.id, provider: a.provider, clinic: a.clinic, category: a.category, duration: a.duration,
  start: a.startMin, dow: 1, hour: a.startMin / 60,
});

export function ctxFor(sim: Sim, settings: Settings, appt: Appointment): Context {
  const busy = new Set<string>();
  for (const b of sim.appts) {
    if (!b.patientId || b.id === appt.id) continue;
    if (b.state === 'cancelled') continue;
    if (b.startMin < appt.startMin + appt.duration + 30 && b.startMin + b.duration + 30 > appt.startMin) busy.add(b.patientId);
  }
  // anyone with a pending offer elsewhere is held back so one person isn't offered two slots at once
  for (const r of Object.values(sim.runs)) {
    if (r.apptId === appt.id) continue;
    for (const o of r.offers) if (o.response === 'pending') busy.add(o.patientId);
  }
  return {
    clinics: clinicById, providers: providerById, model, settings, busy,
    extraOffers: new Map(Object.entries(sim.extraOffers)),
  };
}

export function rank(sim: Sim, settings: Settings, appt: Appointment): MatchResult {
  return matchSlot(slotFromAppt(appt), patients, sim.clock, ctxFor(sim, settings, appt));
}

const describe = (a: Appointment) => `${fmtTime(a.startMin)} ${CATEGORY_LABEL[a.category].toLowerCase()} with ${providerById[a.provider].name}`;

export function cancelAppt(sim: Sim, apptId: string, kind: 'cancel' | 'noshow' = 'cancel'): Sim {
  const appts = sim.appts.map(a => (a.id === apptId ? { ...a, state: 'cancelled' as const, patientId: null } : a));
  const a = sim.appts.find(x => x.id === apptId)!;
  const who = a.patientId ? patientById[a.patientId]?.name ?? 'A patient' : 'A patient';
  const notice = a.startMin - sim.clock;
  const text = kind === 'cancel'
    ? `${who} cancelled the ${describe(a)} (${Math.round(notice / 60 * 10) / 10} h notice).`
    : `${who} is a no-show for the ${describe(a)}.`;
  return {
    ...sim,
    appts,
    runs: { ...sim.runs, [apptId]: { apptId, openedAt: sim.clock, offers: [], wave: 0, status: 'idle' } },
    log: [...sim.log, { at: sim.clock, text, kind: 'cancel' }],
  };
}

export function openRun(sim: Sim, apptId: string): Sim {
  if (sim.runs[apptId]) return sim;
  return { ...sim, runs: { ...sim.runs, [apptId]: { apptId, openedAt: sim.clock, offers: [], wave: 0, status: 'idle' } } };
}

export function sendWave(sim: Sim, apptId: string, settings: Settings, flags: Flags): Sim {
  const appt = sim.appts.find(a => a.id === apptId)!;
  const run = sim.runs[apptId] ?? { apptId, openedAt: sim.clock, offers: [], wave: 0, status: 'idle' as const };
  if (run.status === 'filled' || run.status === 'waiting') return sim;
  const offeredIds = new Set(run.offers.map(o => o.patientId));
  const res = rank(sim, settings, appt);
  const pool = res.candidates.filter(c => !offeredIds.has(c.patient.id));
  const left = appt.startMin - sim.clock;
  const plan = planWaves(pool, left, settings, 1);
  const wave = plan.waves[0];
  if (!wave) {
    return { ...sim, runs: { ...sim.runs, [apptId]: { ...run, status: 'unfilled' } }, log: [...sim.log, { at: sim.clock, text: `No one left who can make the ${describe(appt)}.`, kind: 'info' }] };
  }
  const waveNo = run.wave + 1;
  const firstEver = run.offers.length === 0;
  const offers: Offer[] = wave.candidates.map((c, i) => {
    const manual = firstEver && i === 0;
    const scriptedDecline = flags.scripted && waveNo === 1 && !manual;
    const willAccept = !manual && !scriptedDecline && Math.random() < c.pAccept;
    const silent = !willAccept && Math.random() < 0.45;
    return {
      patientId: c.patient.id, wave: waveNo, sentAt: sim.clock, deadline: sim.clock + wave.timerMin,
      response: 'pending', willAccept, manual, candidate: c,
      respondAt: silent ? Infinity : sim.clock + wave.timerMin * (0.15 + Math.random() * 0.75),
    };
  });
  const extraOffers = { ...sim.extraOffers };
  for (const o of offers) extraOffers[o.patientId] = (extraOffers[o.patientId] ?? 0) + 1;
  return {
    ...sim,
    extraOffers,
    phonePatientId: firstEver ? offers[0].patientId : sim.phonePatientId,
    runs: { ...sim.runs, [apptId]: { ...run, offers: [...run.offers, ...offers], wave: waveNo, status: 'waiting' } },
    log: [...sim.log, {
      at: sim.clock, kind: 'offer',
      text: `Wave ${waveNo}: offered the ${describe(appt)} to ${offers.map(o => patientById[o.patientId].name).join(', ')} (${wave.timerMin} min to answer, ${Math.round(wave.pAny * 100)}% chance one accepts).`,
    }],
  };
}

function fill(sim: Sim, apptId: string, patientId: string): Sim {
  const run = sim.runs[apptId];
  const appt = sim.appts.find(a => a.id === apptId)!;
  const p = patientById[patientId];
  const offers = run.offers.map(o => o.patientId === patientId ? { ...o, response: 'accepted' as const } : o.response === 'pending' ? { ...o, response: 'taken' as const } : o);
  const mins = Math.round(sim.clock - run.openedAt);
  const log: LogEntry[] = [...sim.log, { at: sim.clock, kind: 'fill', text: `${p.name} accepted. The ${describe(appt)} is filled ${mins <= 1 ? 'within a minute' : `in ${mins} min`} with no phone calls.` }];
  if (p.nextBookingInDays) log.push({ at: sim.clock, kind: 'info', text: `${p.name}'s later booking (in ${p.nextBookingInDays} days) is released and goes back into matching.` });
  return {
    ...sim,
    appts: sim.appts.map(a => (a.id === apptId ? { ...a, state: 'filled', patientId, filledBy: patientId } : a)),
    runs: { ...sim.runs, [apptId]: { ...run, offers, status: 'filled', filledBy: patientId, filledAt: sim.clock } },
    log,
  };
}

export function respond(sim: Sim, apptId: string, patientId: string, accept: boolean): Sim {
  const run = sim.runs[apptId];
  const o = run?.offers.find(x => x.patientId === patientId && x.response === 'pending');
  if (!o) return sim;
  if (accept) return fill(sim, apptId, patientId);
  return {
    ...sim,
    runs: { ...sim.runs, [apptId]: { ...run, offers: run.offers.map(x => (x === o ? { ...x, response: 'declined' } : x)) } },
    log: [...sim.log, { at: sim.clock, kind: 'decline', text: `${patientById[patientId].name} passed.` }],
  };
}

export function tick(prev: Sim, dt: number, settings: Settings, flags: Flags): Sim {
  let sim: Sim = { ...prev, clock: prev.clock + dt };
  for (const apptId of Object.keys(sim.runs)) {
    let run = sim.runs[apptId];
    const appt = sim.appts.find(a => a.id === apptId)!;
    if (run.status === 'filled' || run.status === 'unfilled') continue;
    if (sim.clock >= appt.startMin - 5) {
      sim = { ...sim, runs: { ...sim.runs, [apptId]: { ...run, status: 'unfilled', offers: run.offers.map(o => o.response === 'pending' ? { ...o, response: 'expired' } : o) } }, log: [...sim.log, { at: sim.clock, kind: 'info', text: `The ${describe(appt)} went unfilled.` }] };
      continue;
    }
    if (run.status !== 'waiting') continue;
    // simulated answers, earliest first
    const due = run.offers.filter(o => o.response === 'pending' && !o.manual && o.respondAt <= sim.clock).sort((a, b) => a.respondAt - b.respondAt);
    let filled = false;
    for (const o of due) {
      sim = respond(sim, apptId, o.patientId, o.willAccept);
      if (o.willAccept) { filled = true; break; }
    }
    if (filled) continue;
    run = sim.runs[apptId];
    // expire unanswered offers
    const expired = run.offers.filter(o => o.response === 'pending' && o.deadline <= sim.clock);
    if (expired.length) {
      run = { ...run, offers: run.offers.map(o => (o.response === 'pending' && o.deadline <= sim.clock ? { ...o, response: 'expired' } : o)) };
      sim = { ...sim, runs: { ...sim.runs, [apptId]: run }, log: [...sim.log, { at: sim.clock, kind: 'decline', text: `${expired.length} offer${expired.length > 1 ? 's' : ''} timed out.` }] };
    }
    if (!run.offers.some(o => o.response === 'pending')) {
      sim = { ...sim, runs: { ...sim.runs, [apptId]: { ...run, status: 'idle' } } };
      if (flags.autopilot) sim = sendWave(sim, apptId, settings, flags);
    }
  }
  return sim;
}

export function nextScriptedCancellation(sim: Sim): Appointment | undefined {
  const booked = sim.appts.filter(a => a.state === 'booked' && a.startMin >= sim.clock + 150);
  const pref = booked.filter(a => a.provider === 'sudeesh-e').sort((a, b) => Math.abs(a.startMin - 840) - Math.abs(b.startMin - 840));
  return pref[0] ?? booked.sort((a, b) => a.startMin - b.startMin)[0];
}
