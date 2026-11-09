import { useState } from 'react';
import { apptView, VIEW_LABEL, VIEW_PILL } from '../apptState';
import { manualBaseline, planWaves, urgency } from '../engine/match';
import { baseline, clinicById, patientById, providerById, type Appointment } from '../engine/data';
import type { MatchResult, Settings } from '../engine/types';
import type { Run } from '../state';
import { CATEGORY_LABEL, fmtDuration, fmtTime, pct } from '../util';
import { Icon } from '../components/Icon';

const RESPONSE: Record<string, [string, string]> = {
  pending: ['Waiting', 'pending'], accepted: ['Accepted', 'accepted'], declined: ['Declined', 'declined'], expired: ['No answer', 'expired'], taken: ['Slot taken', 'taken'],
};

interface Props {
  appts: Appointment[];
  runs: Record<string, Run>;
  selected: Appointment | null;
  match: MatchResult | null;
  clock: number;
  settings: Settings;
  autopilot: boolean;
  onSelect: (id: string) => void;
  onSendWave: () => void;
  onAutopilot: (v: boolean) => void;
  onOpenPatient: (patientId: string) => void;
  onGoSchedule: () => void;
}

export function Recovery(props: Props) {
  const { appts, runs, selected, match, clock, onSelect, onGoSchedule } = props;
  const cases = appts.filter(a => runs[a.id] || a.state === 'cancelled').sort((a, b) => (runs[b.id]?.openedAt ?? 0) - (runs[a.id]?.openedAt ?? 0));
  const open = appts.filter(a => a.state === 'open' && !runs[a.id] && a.startMin > clock + 30);

  if (!cases.length && !selected) {
    return (
      <section className="card">
        <h2>No recovery cases yet</h2>
        <p className="muted">Cancel a booked appointment on the schedule (or press Simulate a cancellation) and it will appear here with ranked patients.</p>
        <button className="secondary" onClick={onGoSchedule}>Go to schedule →</button>
      </section>
    );
  }

  return (
    <div className="recovery-layout">
      <section className="card">
        <h2>Recovery cases</h2>
        {cases.map(a => {
          const v = apptView(a, runs[a.id], clock);
          return (
            <button key={a.id} className={`case-button ${selected?.id === a.id ? 'case-selected' : ''}`} onClick={() => onSelect(a.id)}>
              <span>{fmtTime(a.startMin)} · {CATEGORY_LABEL[a.category]}</span>
              <span className="muted">{providerById[a.provider].name} · {clinicById[a.clinic].short}</span>
              <span className={`pill ${VIEW_PILL[v]}`}>{VIEW_LABEL[v]}</span>
            </button>
          );
        })}
        {open.length > 0 && (
          <>
            <div className="divider" />
            <div className="eyebrow">Unbooked gaps today</div>
            {open.slice(0, 4).map(a => (
              <button key={a.id} className={`case-button ${selected?.id === a.id ? 'case-selected' : ''}`} onClick={() => onSelect(a.id)}>
                <span>{fmtTime(a.startMin)} · {CATEGORY_LABEL[a.category]}</span>
                <span className="muted">{providerById[a.provider].name} · {a.duration} min</span>
              </button>
            ))}
          </>
        )}
      </section>
      {selected && match ? <CaseDetail {...props} appt={selected} match={match} /> : <section className="card"><div className="blank">Pick a case on the left.</div></section>}
    </div>
  );
}

function CaseDetail({ appt, runs, match, clock, settings, autopilot, onSendWave, onAutopilot, onOpenPatient }: Props & { appt: Appointment; match: MatchResult }) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [tab, setTab] = useState<'ranked' | 'excluded'>('ranked');
  const run = runs[appt.id];
  const prov = providerById[appt.provider];
  const left = appt.startMin - clock;
  const offered = new Set(run?.offers.map(o => o.patientId) ?? []);
  const remaining = match.candidates.filter(c => !offered.has(c.patient.id));
  const plan = planWaves(remaining, left, settings);
  const manual = manualBaseline(baseline, left);
  const u = urgency(left);
  const v = apptView(appt, run, clock);
  const filled = v === 'filled';
  const waiting = run?.status === 'waiting';
  const next = plan.waves[0];
  const waveOf = new Map<string, number>();
  plan.waves.forEach(w => w.candidates.forEach(c => waveOf.set(c.patient.id, (run?.wave ?? 0) + w.index)));
  const pending = run?.offers.filter(o => o.response === 'pending') ?? [];
  const timerLeft = pending.length ? Math.max(0, Math.min(...pending.map(o => o.deadline)) - clock) : 0;
  const offerBy = new Map(run?.offers.map(o => [o.patientId, o]) ?? []);
  const offeredC = run?.offers.map(o => o.candidate) ?? [];
  const list = [...offeredC, ...remaining].slice(0, Math.max(12, offeredC.length + 6));
  const maxScore = Math.max(...match.candidates.map(c => c.score), ...offeredC.map(c => c.score), 0.0001);
  const byRule = new Map<string, typeof match.rejected>();
  for (const r of match.rejected) byRule.set(r.rule, [...(byRule.get(r.rule) ?? []), r]);
  const manualOffer = run?.offers.find(o => o.manual);

  return (
    <section className="card">
      <div className="flex">
        <div>
          <div className="eyebrow">{clinicById[appt.clinic].name}</div>
          <h2 style={{ margin: '4px 0 2px', fontSize: 19 }}>{fmtTime(appt.startMin)} · {CATEGORY_LABEL[appt.category]} with {prov.name}</h2>
          <div className="muted">{appt.duration} min · starts in {fmtDuration(left)}</div>
        </div>
        <span className={`pill ${VIEW_PILL[v]}`}>{VIEW_LABEL[v]}</span>
      </div>

      {filled ? (
        <div className="filled-banner">
          <Icon name="check" size={22} />
          <div><strong>Recovered</strong><div>{patientById[run?.filledBy ?? appt.patientId ?? '']?.name} booked it {run?.filledAt !== undefined && `${Math.max(1, Math.round(run.filledAt - run.openedAt))} min after it opened`} · {run?.offers.length ?? 0} offers sent · 0 phone calls</div></div>
        </div>
      ) : (
        <div className="recover">
          <div className="gauge"><strong>{pct(Math.min(plan.pFill, 0.98))}</strong><span>chance this slot gets filled with matching</span></div>
          <div className="gauge quiet"><strong>{pct(manual.rate)}</strong><span>filled by phone at {manual.label.toLowerCase()} notice (clinic data, n={manual.n})</span></div>
          <div className="urgency">
            <div><b>{u.timerMin} min</b> to answer each offer</div>
            <div><b>{Math.round(u.target * 100)}%</b> acceptance target per wave</div>
            <div>{u.channel}</div>
          </div>
        </div>
      )}

      <div className="funnel">
        <div className="flex" style={{ marginBottom: 6 }}><b style={{ fontSize: 13 }}>Eligibility funnel</b><span className="muted small">hard rules, applied in order</span></div>
        {match.funnel.map((f, i) => (
          <div key={f.rule} className="funnel-row">
            <div className="funnel-label">{f.label}</div>
            <div className="bar"><div className={i === match.funnel.length - 1 ? 'on' : ''} style={{ width: `${(f.remaining / match.funnel[0].remaining) * 100}%` }} /></div>
            <div className="funnel-num">{f.remaining}</div>
          </div>
        ))}
      </div>

      {!filled && (
        <div className="actions">
          <button disabled={waiting || !next || left < 10} onClick={onSendWave}>
            {waiting ? `Wave ${run?.wave} out · ${Math.ceil(timerLeft)} min left` : next ? `Send wave ${(run?.wave ?? 0) + 1} to ${next.candidates.length} ${next.candidates.length === 1 ? 'patient' : 'patients'} (${pct(next.pAny)} likely)` : 'No one left to offer'}
          </button>
          <label className="toggle"><input type="checkbox" checked={autopilot} onChange={e => onAutopilot(e.target.checked)} /> Send next waves automatically</label>
          {manualOffer && <button className="secondary sm" onClick={() => onOpenPatient(manualOffer.patientId)}>Open {patientById[manualOffer.patientId].name.split(' ')[0]}'s app ↗</button>}
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'ranked' ? 'active' : ''} onClick={() => setTab('ranked')}>Ranked ({match.candidates.length})</button>
        <button className={tab === 'excluded' ? 'active' : ''} onClick={() => setTab('excluded')}>Excluded ({match.rejected.length})</button>
        <span className="muted small">score = P(accept) × P(show) × value</span>
      </div>

      {tab === 'excluded' ? (
        <div>
          {[...byRule.entries()].map(([rule, rs]) => (
            <div key={rule} className="list-row"><div><strong>{rs[0].detail}</strong><div className="muted small">e.g. {rs.slice(0, 3).map(r => r.patient.name).join(', ')}</div></div><span className="pill">{rs.length}</span></div>
          ))}
        </div>
      ) : (
        list.map((c, i) => {
          const o = offerBy.get(c.patient.id);
          const w = o ? o.wave : waveOf.get(c.patient.id);
          const resp = o ? RESPONSE[o.response] : null;
          return (
            <div key={c.patient.id} className={`match ${o && o.response === 'accepted' ? 'won' : o && o.response !== 'pending' ? 'dim' : ''}`} onClick={() => setOpenRow(openRow === c.patient.id ? null : c.patient.id)}>
              <div className="match-row">
                <div className="rank">{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="match-name">
                    {c.patient.name} <small>{c.patient.id.slice(0, 9)}</small>
                    {w !== undefined && <span className={`wave-tag ${o ? '' : 'planned'}`}>Wave {w}</span>}
                    {resp && <span className={`pill ${resp[1]}`}>{resp[0]}</span>}
                  </div>
                  <div className="chips">{c.reasons.map(r => <span key={r} className="chip">{r}</span>)}</div>
                </div>
                <div className="score-col">
                  <div className="flex" style={{ gap: 4 }}><span className="score">{Math.round((c.score / maxScore) * 100)}</span><span className="muted small">accept {pct(c.pAccept)} · show {pct(c.pShow)}</span></div>
                  <div className="bar"><div style={{ width: `${(c.score / maxScore) * 100}%` }} /></div>
                </div>
              </div>
              {openRow === c.patient.id && (
                <div className="breakdown">
                  <div><span>P(accept)</span><b>{pct(c.pAccept)}</b><em>availability, distance, how much sooner, past answers, offers this week</em></div>
                  <div><span>P(show)</span><b>{pct(c.pShow)}</b><em>model trained on clinic visits: {c.patient.history.visits} visits, {c.patient.history.cancels} cancels, {pct(c.patient.history.online)} booked online</em></div>
                  <div><span>Fit</span><b>{c.fit.toFixed(2)}</b><em>same provider, time window, language, under 15 min away</em></div>
                  <div><span>Need</span><b>{c.need.toFixed(2)}</b><em>{c.patient.acute ? 'acute flag from clinic' : c.patient.need.payer !== 'private' ? `${c.patient.need.payer} treatment plan` : 'routine care'}</em></div>
                  <div><span>Wait</span><b>{c.wait.toFixed(2)}</b><em>{c.patient.waitingDays ? `on waitlist ${c.patient.waitingDays} days` : `next booking in ${c.patient.nextBookingInDays} days`}</em></div>
                  <div><span>Score</span><b>{c.score.toFixed(3)}</b><em>{pct(c.pAccept)} × {pct(c.pShow)} × value {c.value.toFixed(2)}</em></div>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
