import { clinicById, patientById, providerById, showcase, type Appointment } from '../engine/data';
import type { Run } from '../state';
import { CATEGORY_LABEL, fmtTime } from '../util';

const DAY_START = 9 * 60;
const DAY_END = 18 * 60 + 40;
const PX = 0.95; // pixels per minute

interface Props {
  appts: Appointment[];
  runs: Record<string, Run>;
  clock: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCancel: (id: string, kind: 'cancel' | 'noshow') => void;
  menuId: string | null;
  setMenuId: (id: string | null) => void;
}

function stateOf(a: Appointment, run: Run | undefined, clock: number) {
  if (a.state === 'filled') return 'filled';
  if (run?.status === 'waiting') return 'offering';
  if (run?.status === 'unfilled' || ((a.state === 'cancelled' || a.state === 'open') && a.startMin < clock)) return 'lost';
  if (a.state === 'cancelled') return 'cancelled';
  if (a.state === 'open') return 'open';
  if (a.startMin + a.duration <= clock) return 'past';
  return 'booked';
}

export function Schedule({ appts, runs, clock, selectedId, onSelect, onCancel, menuId, setMenuId }: Props) {
  const hours: number[] = [];
  for (let h = 9; h <= 18; h++) hours.push(h * 60);
  const height = (DAY_END - DAY_START) * PX;
  return (
    <div className="schedule">
      <div className="sched-head">
        <div className="sched-gutter" />
        {showcase.map(pid => {
          const p = providerById[pid];
          const clinic = appts.find(a => a.provider === pid)?.clinic ?? p.clinics[0];
          return (
            <div key={pid} className="sched-col-head">
              <div className="prov-name">{p.name}</div>
              <div className="prov-sub">{CATEGORY_LABEL[p.categories[0]]} · {clinicById[clinic].short}</div>
            </div>
          );
        })}
      </div>
      <div className="sched-body" style={{ height }}>
        <div className="sched-gutter">
          {hours.map(m => (
            <div key={m} className={`hour-label ${m === DAY_START ? "first" : ""}`} style={{ top: (m - DAY_START) * PX }}>{fmtTime(m).replace(':00', '')}</div>
          ))}
        </div>
        {hours.map(m => <div key={m} className="hour-line" style={{ top: (m - DAY_START) * PX }} />)}
        {clock >= DAY_START && clock <= DAY_END && (
          <div className="now-line" style={{ top: (clock - DAY_START) * PX }}><span>{fmtTime(clock)}</span></div>
        )}
        {showcase.map(pid => (
          <div key={pid} className="sched-col">
            {appts.filter(a => a.provider === pid).map(a => {
              const run = runs[a.id];
              const st = stateOf(a, run, clock);
              const pt = a.patientId ? patientById[a.patientId] : null;
              const clickable = st === 'booked' || st === 'cancelled' || st === 'open' || st === 'offering' || st === 'filled';
              return (
                <div
                  key={a.id}
                  className={`appt st-${st} ${selectedId === a.id ? 'selected' : ''}`}
                  style={{ top: (a.startMin - DAY_START) * PX + 1, height: a.duration * PX - 2 }}
                  onClick={() => {
                    if (!clickable) return;
                    if (st === 'booked') setMenuId(menuId === a.id ? null : a.id);
                    else onSelect(a.id);
                  }}
                  title={`${fmtTime(a.startMin)} · ${a.duration} min ${CATEGORY_LABEL[a.category]}`}
                >
                  <div className="appt-time">{fmtTime(a.startMin)}</div>
                  {a.duration >= 25 && (
                    <div className="appt-who">
                      {st === 'cancelled' && 'Cancelled · tap to match'}
                      {st === 'open' && 'Open · tap to match'}
                      {st === 'offering' && 'Offering…'}
                      {st === 'filled' && `Filled · ${pt?.name ?? ''}`}
                      {st === 'lost' && 'Unfilled'}
                      {(st === 'booked' || st === 'past') && (pt?.name ?? 'Booked')}
                    </div>
                  )}
                  {menuId === a.id && (
                    <div className="appt-menu" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { onCancel(a.id, 'cancel'); setMenuId(null); }}>Patient cancels</button>
                      <button onClick={() => { onCancel(a.id, 'noshow'); setMenuId(null); }} disabled={a.startMin > clock + 15}>Mark no-show</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
