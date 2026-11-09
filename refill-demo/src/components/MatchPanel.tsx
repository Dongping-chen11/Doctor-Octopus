import { useState } from 'react';
import { manualBaseline, planWaves, urgency } from '../engine/match';
import { baseline, clinicById, patientById, providerById, type Appointment } from '../engine/data';
import type { MatchResult, Settings } from '../engine/types';
import type { Run } from '../state';
import { CATEGORY_LABEL, fmtDuration, fmtTime, pct } from '../util';

interface Props {
  appt: Appointment;
  run: Run | undefined;
  match: MatchResult;
  clock: number;
  settings: Settings;
  autopilot: boolean;
  onSendWave: () => void;
  onAutopilot: (v: boolean) => void;
}

const RESPONSE_LABEL: Record<string, string> = {
  pending: 'Waiting', accepted: 'Accepted', declined: 'Passed', expired: 'No answer', taken: 'Slot taken',
};

export function MatchPanel({ appt, run, match, clock, settings, autopilot, onSendWave, onAutopilot }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const prov = providerById[appt.provider];
  const left = appt.startMin - clock;
  const offeredIds = new Set(run?.offers.map(o => o.patientId) ?? []);
  const remaining = match.candidates.filter(c => !offeredIds.has(c.patient.id));
  const plan = planWaves(remaining, left, settings);
  const manual = manualBaseline(baseline, left);
  const u = urgency(left);
  const filled = run?.status === 'filled' || appt.state === 'filled';
  const waiting = run?.status === 'waiting';
  const nextWave = plan.waves[0];
  const waveOf = new Map<string, number>();
  plan.waves.forEach(w => w.candidates.forEach(c => waveOf.set(c.patient.id, (run?.wave ?? 0) + w.index)));
  const pending = run?.offers.filter(o => o.response === 'pending') ?? [];
  const timerLeft = pending.length ? Math.max(0, Math.min(...pending.map(o => o.deadline)) - clock) : 0;
  const offerByPatient = new Map(run?.offers.map(o => [o.patientId, o]) ?? []);
  const offeredCandidates = run?.offers.map(o => o.candidate) ?? [];
  const list = [...offeredCandidates, ...remaining].slice(0, Math.max(12, offeredCandidates.length + 6));
  const maxScore = Math.max(...match.candidates.map(c => c.score), 0.0001);

  const byRule = new Map<string, typeof match.rejected>();
  for (const r of match.rejected) byRule.set(r.rule, [...(byRule.get(r.rule) ?? []), r]);

  return (
    <div className="panel match">
      <div className="slot-head">
        <div>
          <div className={`eyebrow ${filled ? 'ok' : ''}`}>{filled ? 'Filled slot' : appt.state === 'open' ? 'Open slot' : 'Cancelled slot'}</div>
          <h2>{fmtTime(appt.startMin)} · {CATEGORY_LABEL[appt.category]} with {prov.name}</h2>
          <div className="muted">{appt.duration} min · {clinicById[appt.clinic].name} · starts in {fmtDuration(left)}</div>
        </div>
      </div>

      {filled ? (
        <div className="filled-banner">
          <div className="big">Filled</div>
          <div>
            {patientById[run?.filledBy ?? appt.patientId ?? '']?.name} booked it
            {run?.filledAt !== undefined && ` ${Math.round(run.filledAt - run.openedAt) <= 1 ? 'within a minute' : `${Math.round(run.filledAt - run.openedAt)} min`} after it opened`}
            , after {run?.offers.length ?? 0} offers and 0 phone calls.
          </div>
        </div>
      ) : (
        <div className="recover">
          <div className="gauge">
            <div className="gauge-num">{pct(Math.min(plan.pFill, 0.98))}</div>
            <div className="gauge-label">likely to fill with matching</div>
          </div>
          <div className="gauge quiet">
            <div className="gauge-num">{pct(manual.rate)}</div>
            <div className="gauge-label">filled by hand at {manual.label.toLowerCase()} notice (real data, n={manual.n})</div>
          </div>
          <div className="urgency">
            <div><b>{u.timerMin} min</b> to answer</div>
            <div><b>{Math.round(u.target * 100)}%</b> target per wave</div>
            <div>{u.channel}</div>
          </div>
        </div>
      )}

      <div className="funnel">
        {match.funnel.map((f, i) => (
          <div key={f.rule} className="funnel-row" title={f.label}>
            <div className="funnel-label">{f.label}</div>
            <div className="funnel-bar"><div style={{ width: `${(f.remaining / match.funnel[0].remaining) * 100}%` }} className={i === match.funnel.length - 1 ? 'last' : ''} /></div>
            <div className="funnel-num">{f.remaining}</div>
          </div>
        ))}
        <button className="link" onClick={() => setShowRejected(!showRejected)}>{showRejected ? 'Hide' : 'Why not the others?'}</button>
        {showRejected && (
          <div className="rejected">
            {[...byRule.entries()].map(([rule, rs]) => (
              <div key={rule}><b>{rs.length}</b> · {rs[0].detail}{rs.length > 1 ? ` (e.g. ${rs[0].patient.name})` : ''}</div>
            ))}
          </div>
        )}
      </div>

      {!filled && (
        <div className="actions">
          <button className="primary" disabled={waiting || !nextWave || left < 10} onClick={onSendWave}>
            {waiting ? `Wave ${run?.wave} out · ${Math.ceil(timerLeft)} min left` : nextWave ? `Send wave ${(run?.wave ?? 0) + 1} to ${nextWave.candidates.length} ${nextWave.candidates.length === 1 ? 'person' : 'people'} (${pct(nextWave.pAny)})` : 'No one left to offer'}
          </button>
          <label className="toggle"><input type="checkbox" checked={autopilot} onChange={e => onAutopilot(e.target.checked)} /> Autopilot next waves</label>
        </div>
      )}

      <div className="cands">
        <div className="cands-head"><span>Ranked matches</span><span className="muted">{match.candidates.length} eligible · score = P(accept) × P(show) × value</span></div>
        {list.map((c, i) => {
          const o = offerByPatient.get(c.patient.id);
          const w = o ? o.wave : waveOf.get(c.patient.id);
          return (
            <div key={c.patient.id} className={`cand ${o ? `resp-${o.response}` : ''}`} onClick={() => setOpen(open === c.patient.id ? null : c.patient.id)}>
              <div className="cand-row">
                <div className="rank">{i + 1}</div>
                <div className="cand-main">
                  <div className="cand-name">
                    {c.patient.name}
                    {w !== undefined && <span className={`wave-tag ${o ? '' : 'planned'}`}>Wave {w}</span>}
                    {o && <span className={`resp resp-${o.response}`}>{RESPONSE_LABEL[o.response]}</span>}
                  </div>
                  <div className="chips">{c.reasons.map(r => <span key={r} className="chip">{r}</span>)}</div>
                </div>
                <div className="cand-score">
                  <div className="scorebar"><div style={{ width: `${(c.score / maxScore) * 100}%` }} /></div>
                  <div className="muted small">accept {pct(c.pAccept)} · show {pct(c.pShow)}</div>
                </div>
              </div>
              {open === c.patient.id && (
                <div className="breakdown">
                  <div><span>P(accept)</span><b>{pct(c.pAccept)}</b><em>availability, distance, how much sooner, past answers, offers this week</em></div>
                  <div><span>P(show)</span><b>{pct(c.pShow)}</b><em>model trained on real visits: {c.patient.history.visits} visits, {c.patient.history.cancels} cancels, {pct(c.patient.history.online)} booked online</em></div>
                  <div><span>Fit</span><b>{c.fit.toFixed(2)}</b><em>same provider, time window, language, under 15 min away</em></div>
                  <div><span>Need</span><b>{c.need.toFixed(2)}</b><em>{c.patient.acute ? 'acute flag from clinic' : c.patient.need.payer !== 'private' ? `${c.patient.need.payer} treatment plan` : 'routine care'}</em></div>
                  <div><span>Wait</span><b>{c.wait.toFixed(2)}</b><em>{c.patient.waitingDays ? `on waitlist ${c.patient.waitingDays} days` : `next booking in ${c.patient.nextBookingInDays} days`}</em></div>
                  <div><span>Score</span><b>{c.score.toFixed(3)}</b><em>{pct(c.pAccept)} × {pct(c.pShow)} × value {c.value.toFixed(2)}</em></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
