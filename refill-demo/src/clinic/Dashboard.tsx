import { apptView, VIEW_LABEL, VIEW_PILL } from '../apptState';
import { providerById, type Appointment } from '../engine/data';
import type { LogEntry, Run } from '../state';
import { CATEGORY_LABEL, fmtTime } from '../util';

interface Props {
  appts: Appointment[];
  runs: Record<string, Run>;
  log: LogEntry[];
  clock: number;
  onOpenRecovery: (id: string) => void;
  onGoSchedule: () => void;
  onSimulate: () => void;
}

export function Dashboard({ appts, runs, log, clock, onOpenRecovery, onGoSchedule, onSimulate }: Props) {
  const views = appts.map(a => ({ a, v: apptView(a, runs[a.id], clock) }));
  const cancelled = Object.keys(runs).length;
  const recovered = views.filter(x => x.v === 'filled');
  const hours = recovered.reduce((s, x) => s + x.a.duration, 0) / 60;
  const offers = Object.values(runs).reduce((s, r) => s + r.offers.length, 0);
  const open = views.filter(x => x.v === 'cancelled' || x.v === 'offering');
  const waiting = Object.values(runs).filter(r => r.status === 'waiting');
  const booked = views.filter(x => x.v === 'booked' || x.v === 'past').length;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Appointments today</small><strong>{appts.length}</strong><div className="muted">{booked} booked · 6 practitioners</div></div>
        <div className="kpi"><small>Cancellations today</small><strong>{cancelled}</strong><div className="muted">released for matching</div></div>
        <div className="kpi accent"><small>Recovered slots</small><strong>{recovered.length}</strong><div className="muted">{hours.toFixed(1)} provider-hours saved</div></div>
        <div className="kpi"><small>Offers sent</small><strong>{offers}</strong><div className="muted">{waiting.length} waves waiting</div></div>
        <div className="kpi"><small>Phone calls needed</small><strong>0</strong><div className="muted">vs about 6 per slot by hand</div></div>
      </div>
      <div className="grid">
        <section className="card">
          <div className="flex"><h2>Recovery opportunities</h2><button className="link" onClick={onGoSchedule}>Open schedule →</button></div>
          {open.length ? open.map(({ a, v }) => (
            <div key={a.id} className="list-row">
              <div><strong>{fmtTime(a.startMin)} · {CATEGORY_LABEL[a.category]} with {providerById[a.provider].name}</strong><div className="muted">{a.duration} min · starts in {Math.round((a.startMin - clock) / 6) / 10} h</div></div>
              <div className="row"><span className={`pill ${VIEW_PILL[v]}`}>{VIEW_LABEL[v]}</span><button className="secondary sm" onClick={() => onOpenRecovery(a.id)}>Review matches →</button></div>
            </div>
          )) : (
            <div className="blank">
              No open cancellations right now.
              <div style={{ marginTop: 12 }}><button className="danger sm" onClick={onSimulate}>Simulate a cancellation</button></div>
            </div>
          )}
          {recovered.length > 0 && (
            <>
              <div className="divider" />
              <div className="eyebrow">Recovered today</div>
              {recovered.map(({ a }) => (
                <div key={a.id} className="list-row"><div><strong>{fmtTime(a.startMin)} · {CATEGORY_LABEL[a.category]}</strong><div className="muted">{providerById[a.provider].name}</div></div><span className="pill filled">Recovered</span></div>
              ))}
            </>
          )}
        </section>
        <section className="card">
          <h2>Live activity</h2>
          <div className="log">
            {log.slice(-7).reverse().map((l, i) => <div key={i} className={`k-${l.kind}`}><span>{fmtTime(l.at)}</span><span>{l.text}</span></div>)}
          </div>
          <div className="divider" />
          <h2>How recovery works</h2>
          <ol className="steps">
            <li>A patient cancels; the slot is released</li>
            <li>Rules find who can take it; the model ranks them</li>
            <li>Offers go out in small timed waves</li>
            <li>First to accept is booked into the clinic system</li>
          </ol>
        </section>
      </div>
    </>
  );
}
