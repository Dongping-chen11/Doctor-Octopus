import { clinicById, patientById, providerById, type Appointment } from '../engine/data';
import type { Offer, Run } from '../state';
import { CATEGORY_LABEL, dayLabel, fmtTime } from '../util';

interface Props {
  patientId: string | null;
  runs: Record<string, Run>;
  appts: Appointment[];
  clock: number;
  onRespond: (apptId: string, patientId: string, accept: boolean) => void;
}

export function Phone({ patientId, runs, appts, clock, onRespond }: Props) {
  const p = patientId ? patientById[patientId] : null;
  let offer: Offer | undefined;
  let run: Run | undefined;
  if (p) {
    for (const r of Object.values(runs)) {
      const o = [...r.offers].reverse().find(x => x.patientId === p.id);
      if (o && (!offer || o.sentAt > offer.sentAt)) { offer = o; run = r; }
    }
  }
  const appt = run ? appts.find(a => a.id === run!.apptId) : undefined;
  const windows = p ? Object.entries(p.windows).filter(([, v]) => v).map(([k]) => k) : [];

  return (
    <div className="phone-wrap">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-status"><span>{fmtTime(clock).replace(' AM', '').replace(' PM', '')}</span><span>5G ▮▮▮</span></div>
        {!p && (
          <div className="phone-screen center">
            <div className="app-logo">Refill</div>
            <p className="muted">When a slot is offered, the top-ranked patient's phone appears here.</p>
          </div>
        )}
        {p && (
          <div className="phone-screen">
            <div className="app-bar"><span className="app-logo sm">Refill</span><span className="avatar">{p.name[0]}</span></div>
            <div className="hello">Hi {p.name.split(' ')[0]}</div>
            {p.nextBookingInDays && (!offer || offer.response !== 'accepted') && (
              <div className="card subtle">
                <div className="small muted">Your next appointment</div>
                <div><b>{dayLabel(p.nextBookingInDays)}</b> · {CATEGORY_LABEL[p.need.category]} with {providerById[p.provider].name}</div>
              </div>
            )}
            <div className="card subtle row">
              <div>
                <div><b>Offer me earlier slots</b></div>
                <div className="small muted">{p.flexMode ? `${windows.join(', ')}` : 'Off'}</div>
              </div>
              <div className={`switch ${p.flexMode ? 'on' : ''}`}><div /></div>
            </div>
            <div className="chip-row">
              <span className={`pill ${p.freeToday ? 'on' : ''}`}>{p.freeToday ? '✓ ' : ''}I'm free today</span>
              <span className="pill">Pause offers</span>
            </div>

            {offer && appt && offer.response === 'pending' && (
              <div className="offer">
                <div className="offer-tag">Earlier slot available</div>
                <div className="offer-title">Today, {fmtTime(appt.startMin)}</div>
                <div>{CATEGORY_LABEL[appt.category]} with {providerById[appt.provider].name}</div>
                <div className="small muted">{appt.duration} min · {clinicById[appt.clinic].short} · about {offer.candidate.travelMin} min away</div>
                {p.nextBookingInDays && <div className="small">Replaces your {dayLabel(p.nextBookingInDays)} visit</div>}
                <div className="countdown">
                  <div style={{ width: `${Math.max(0, (offer.deadline - clock) / (offer.deadline - offer.sentAt)) * 100}%` }} />
                </div>
                <div className="small muted">Held for you for {Math.max(0, Math.ceil(offer.deadline - clock))} more min · first to accept gets it</div>
                <div className="offer-actions">
                  <button className="ghost" onClick={() => onRespond(run!.apptId, p.id, false)}>Pass</button>
                  <button className="primary" onClick={() => onRespond(run!.apptId, p.id, true)}>Accept</button>
                </div>
              </div>
            )}
            {offer && appt && offer.response === 'accepted' && (
              <div className="offer done">
                <div className="offer-tag ok">Booked</div>
                <div className="offer-title">Today, {fmtTime(appt.startMin)}</div>
                <div>{CATEGORY_LABEL[appt.category]} with {providerById[appt.provider].name}</div>
                {p.nextBookingInDays && <div className="small">Your {dayLabel(p.nextBookingInDays)} visit was released for someone else.</div>}
                <button className="ghost full">Get directions</button>
              </div>
            )}
            {offer && offer.response === 'taken' && <div className="offer muted-card">That slot was just taken. You keep your place, with priority for the next one.</div>}
            {offer && (offer.response === 'declined' || offer.response === 'expired') && <div className="offer muted-card">No problem, we'll keep looking for you.</div>}
          </div>
        )}
      </div>
      {p && <div className="phone-caption">{p.name}'s phone</div>}
    </div>
  );
}
