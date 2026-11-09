import { apptView, VIEW_LABEL, VIEW_PILL } from '../apptState';
import { clinicById, patientById, providerById, showcase, type Appointment } from '../engine/data';
import type { Run } from '../state';
import { CATEGORY_LABEL, fmtTime } from '../util';
import { Icon } from '../components/Icon';

const DAY_START = 9 * 60;
const DAY_END = 18 * 60 + 40;
const PX = 0.95;

interface Props {
  appts: Appointment[];
  runs: Record<string, Run>;
  clock: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCancel: (id: string, kind: 'cancel' | 'noshow') => void;
  onOpenRecovery: (id: string) => void;
  onSimulate: () => void;
}

export function ClinicSchedule({ appts, runs, clock, selectedId, onSelect, onCancel, onOpenRecovery, onSimulate }: Props) {
  const hours: number[] = [];
  for (let h = 9; h <= 18; h++) hours.push(h * 60);
  const height = (DAY_END - DAY_START) * PX;
  const sel = appts.find(a => a.id === selectedId);
  const selView = sel ? apptView(sel, runs[sel.id], clock) : null;
  const selPatient = sel?.patientId ? patientById[sel.patientId] : null;

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(260px, 1fr)' }}>
      <section className="card">
        <div className="flex">
          <h2 style={{ margin: 0 }}>Day calendar · {appts.length} appointments · {showcase.length} practitioners</h2>
          <button className="danger sm" onClick={onSimulate}><span className="row" style={{ gap: 6 }}><Icon name="zap" size={14} />Simulate a cancellation</span></button>
        </div>
        <div className="legend">
          {(['booked', 'cancelled', 'offering', 'filled', 'open'] as const).map(v => <span key={v} className={`pill ${VIEW_PILL[v]}`}>{VIEW_LABEL[v]}</span>)}
          <span className="muted">Click any appointment for details.</span>
        </div>
        <div className="calendar-scroller">
          <div className="day-calendar">
            <div className="hour-column" style={{ height }}>
              {hours.map(m => <div key={m} className={`hour-marker ${m === DAY_START ? 'first' : ''}`} style={{ top: (m - DAY_START) * PX }}>{String(m / 60).padStart(2, '0')}:00</div>)}
            </div>
            {showcase.map((pid, ci) => {
              const p = providerById[pid];
              const clinic = appts.find(a => a.provider === pid)?.clinic ?? p.clinics[0];
              return (
                <div key={pid} className="pract-column">
                  <div className="pract-title">{p.name}<span>{CATEGORY_LABEL[p.categories[0]]} · {clinicById[clinic].short}</span></div>
                  <div className="pract-lane" style={{ height }}>
                    {clock >= DAY_START && clock <= DAY_END && (
                      <div className="now-line" style={{ top: (clock - DAY_START) * PX }}>{ci === 0 && <span className="now-tag">{fmtTime(clock).replace(' AM', '').replace(' PM', '')}</span>}</div>
                    )}
                    {appts.filter(a => a.provider === pid).map(a => {
                      const v = apptView(a, runs[a.id], clock);
                      const pt = a.patientId ? patientById[a.patientId] : null;
                      return (
                        <button
                          key={a.id}
                          className={`cal-event ${v} ${selectedId === a.id ? 'selected' : ''}`}
                          style={{ top: (a.startMin - DAY_START) * PX + 1, height: Math.max(18, a.duration * PX - 2) }}
                          onClick={() => onSelect(a.id)}
                          title={`${fmtTime(a.startMin)} · ${a.duration} min ${CATEGORY_LABEL[a.category]}`}
                        >
                          <span>{fmtTime(a.startMin).replace(' AM', '').replace(' PM', '')} {a.duration >= 30 ? CATEGORY_LABEL[a.category] : ''}</span>
                          {a.duration >= 25 && <small>{v === 'booked' || v === 'past' || v === 'filled' ? pt?.name ?? '' : VIEW_LABEL[v]}</small>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Appointment details</h2>
        {!sel || !selView ? (
          <div className="blank">Select an appointment on the calendar.</div>
        ) : (
          <>
            <div className="eyebrow">{clinicById[sel.clinic].name}</div>
            <div className="flex" style={{ marginTop: 6 }}>
              <strong style={{ fontSize: 16 }}>{CATEGORY_LABEL[sel.category]} · {sel.duration} min</strong>
              <span className={`pill ${VIEW_PILL[selView]}`}>{VIEW_LABEL[selView]}</span>
            </div>
            <p className="muted">Today · {fmtTime(sel.startMin)} to {fmtTime(sel.startMin + sel.duration)} · {providerById[sel.provider].name}</p>
            {selPatient && (
              <div className="feature" style={{ borderColor: 'var(--line)' }}>
                <div className="flex"><strong>{selPatient.name}</strong><span className="muted small">{selPatient.history.visits} visits</span></div>
                <div className="muted small">Patient since last year · {selPatient.need.payer !== 'private' ? `${selPatient.need.payer} plan` : 'Private pay'}</div>
              </div>
            )}
            <div className="divider" />
            <div className="row">
              {selView === 'booked' && (
                <>
                  <button className="danger" onClick={() => onCancel(sel.id, 'cancel')}>Patient cancelled</button>
                  <button className="secondary" disabled={sel.startMin > clock + 15} onClick={() => onCancel(sel.id, 'noshow')}>Mark no-show</button>
                </>
              )}
              {(selView === 'cancelled' || selView === 'open' || selView === 'offering' || selView === 'filled') && (
                <button onClick={() => onOpenRecovery(sel.id)}>Open appointment recovery →</button>
              )}
            </div>
            {selView === 'booked' && <p className="muted" style={{ marginTop: 12 }}>Cancelling releases the time and starts matching right away. Staff can review every offer before it goes out.</p>}
          </>
        )}
      </section>
    </div>
  );
}
