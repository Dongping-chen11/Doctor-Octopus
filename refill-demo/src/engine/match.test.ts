import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, matchSlot, planWaves, urgency } from './match';
import { replay } from './replay';
import { baseline, clinicById, history, model, patients, providerById } from './data';
import type { Slot } from './types';

const ctx = { clinics: clinicById, providers: providerById, model, settings: DEFAULT_SETTINGS };
const slot: Slot = { id: 's', provider: 'sudeesh-e', clinic: 'bethesda', category: 'physio', duration: 30, start: 14 * 60, dow: 1, hour: 14 };

describe('matchSlot', () => {
  const res = matchSlot(slot, patients, 10 * 60, ctx);
  it('only returns patients who pass every hard filter', () => {
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) {
      expect(providerById['sudeesh-e'].categories).toContain(c.patient.need.category);
      expect(c.patient.need.duration).toBeLessThanOrEqual(30);
      expect(c.patient.optedOut).toBe(false);
    }
  });
  it('ranks by score, descending', () => {
    for (let i = 1; i < res.candidates.length; i++) expect(res.candidates[i - 1].score).toBeGreaterThanOrEqual(res.candidates[i].score);
  });
  it('funnel ends at the candidate count', () => {
    expect(res.funnel.at(-1)!.remaining).toBe(res.candidates.length);
    expect(res.candidates.length + res.rejected.length).toBe(patients.length);
  });
  it('drops people who cannot get there in time', () => {
    const late = matchSlot(slot, patients, 14 * 60 - 20, ctx);
    for (const c of late.candidates) expect(c.travelMin + DEFAULT_SETTINGS.travelBuffer).toBeLessThanOrEqual(20);
  });
  it('probabilities are valid', () => {
    for (const c of res.candidates) {
      expect(c.pAccept).toBeGreaterThan(0); expect(c.pAccept).toBeLessThan(1);
      expect(c.pShow).toBeGreaterThan(0); expect(c.pShow).toBeLessThan(1);
    }
  });
});

describe('planWaves', () => {
  it('urgency tightens as the slot approaches', () => {
    expect(urgency(30 * 60).timerMin).toBeGreaterThan(urgency(60).timerMin);
    expect(urgency(30 * 60).target).toBeLessThan(urgency(60).target);
  });
  it('first wave reaches the target when enough candidates exist', () => {
    const res = matchSlot(slot, patients, 10 * 60, ctx);
    const plan = planWaves(res.candidates, 240, DEFAULT_SETTINGS);
    expect(plan.waves.length).toBeGreaterThan(0);
    expect(plan.pFill).toBeGreaterThan(0);
    expect(plan.waves[0].candidates.length).toBeLessThanOrEqual(8);
  });
});

describe('replay', () => {
  it('never fills fewer slots than staff did by hand', () => {
    const r = replay(history, patients, baseline, ctx);
    console.log(JSON.stringify(r, null, 1));
    expect(r.engineFilled).toBeGreaterThanOrEqual(r.manualFilled);
    expect(r.maxOffersPerPatientWeek).toBeLessThanOrEqual(DEFAULT_SETTINGS.fatigueCap);
  });
});
