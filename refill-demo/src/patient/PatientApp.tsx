import { useMemo, useState } from 'react';
import { clinicById, providerById, type Appointment } from '../engine/data';
import type { Category, Patient } from '../engine/types';
import type { Offer, Run } from '../state';
import { CATEGORY_LABEL, dayLabel, fmtTime } from '../util';
import { Icon } from '../components/Icon';
import { initials, LISTINGS, listingDistance, recommend } from './directory';

export type PatientTab = 'home' | 'find' | 'notifications' | 'appointments' | 'preferences';

export interface Notice {
  id: string;
  at: number; // demo-clock minutes; negative = earlier days
  when: string;
  icon: string;
  tone: '' | 'good' | 'bad' | 'info';
  title: string;
  body: string;
  offer?: Offer;
  apptId?: string;
}

const DEMO_DATE = new Date('2026-11-10T12:00:00');
function dateParts(daysAhead: number) {
  const d = new Date(DEMO_DATE.getTime() + daysAhead * 864e5);
  return { mon: d.toLocaleDateString('en-CA', { month: 'short' }), day: d.getDate(), wd: d.toLocaleDateString('en-CA', { weekday: 'long' }) };
}
export function usualTime(p: Patient) {
  return p.windows.morning ? 10 * 60 + 30 : p.windows.afternoon ? 14 * 60 + 30 : 17 * 60 + 30;
}

export function findOffers(p: Patient, runs: Record<string, Run>) {
  const out: { offer: Offer; run: Run }[] = [];
  for (const r of Object.values(runs)) for (const o of r.offers) if (o.patientId === p.id) out.push({ offer: o, run: r });
  return out.sort((a, b) => b.offer.sentAt - a.offer.sentAt);
}

export function notificationsFor(p: Patient, runs: Record<string, Run>, appts: Appointment[]): Notice[] {
  const list: Notice[] = [];
  for (const { offer: o, run } of findOffers(p, runs)) {
    const a = appts.find(x => x.id === run.apptId)!;
    const what = `${CATEGORY_LABEL[a.category]} with ${providerById[a.provider].name}, today at ${fmtTime(a.startMin)}`;
    list.push({ id: `${a.id}-offer`, at: o.sentAt, when: fmtTime(o.sentAt), icon: 'zap', tone: '', title: 'Earlier appointment available', body: `${what}. Held for you for ${Math.round(o.deadline - o.sentAt)} minutes.`, offer: o, apptId: a.id });
    if (o.response === 'accepted') list.push({ id: `${a.id}-ok`, at: run.filledAt ?? o.sentAt + 1, when: fmtTime(run.filledAt ?? o.sentAt), icon: 'check', tone: 'good', title: 'Booking confirmed', body: `${what} at ${clinicById[a.clinic].short}.${p.nextBookingInDays ? ` Your ${dayLabel(p.nextBookingInDays)} visit was released.` : ''}`, apptId: a.id });
    if (o.response === 'taken') list.push({ id: `${a.id}-taken`, at: run.filledAt ?? o.deadline, when: fmtTime(run.filledAt ?? o.deadline), icon: 'x', tone: 'bad', title: 'That slot was taken', body: 'Someone accepted first. You keep priority for the next opening.' });
    if (o.response === 'expired') list.push({ id: `${a.id}-exp`, at: o.deadline, when: fmtTime(o.deadline), icon: 'clock', tone: 'bad', title: 'Offer expired', body: 'No problem. We will keep looking for an earlier time that fits.' });
  }
  if (p.nextBookingInDays) list.push({ id: 'reminder', at: -600, when: 'Yesterday', icon: 'calendar', tone: 'info', title: 'Upcoming appointment', body: `${CATEGORY_LABEL[p.need.category]} with ${providerById[p.provider].name} on ${dayLabel(p.nextBookingInDays)} at ${fmtTime(usualTime(p))}.` });
  if (p.waitingDays) list.push({ id: 'waitlist', at: -2000, when: `${Math.min(p.waitingDays, 3)} days ago`, icon: 'list', tone: 'info', title: 'You are on the waitlist', body: `${CATEGORY_LABEL[p.need.category]} at ${clinicById[p.homeClinic].short}. Turn on earlier-slot offers to be seen sooner.` });
  list.push({ id: 'flex', at: -5000, when: 'Last week', icon: 'bell', tone: '', title: 'Earlier-slot offers are on', body: 'We will only message you about openings that fit your times, travel and care plan. At most 5 a week.' });
  return list.sort((a, b) => b.at - a.at);
}

interface Props {
  patient: Patient;
  runs: Record<string, Run>;
  appts: Appointment[];
  clock: number;
  tab: PatientTab;
  setTab: (t: PatientTab) => void;
  onRespond: (apptId: string, patientId: string, accept: boolean) => void;
  seenAt: number;
}

export function PatientApp(props: Props) {
  const { tab } = props;
  return (
    <>
      {tab === 'home' && <Home {...props} />}
      {tab === 'find' && <FindCare {...props} />}
      {tab === 'notifications' && <Notifications {...props} />}
      {tab === 'appointments' && <Appointments {...props} />}
      {tab === 'preferences' && <Preferences {...props} />}
    </>
  );
}

function OfferCard({ offer, run, appts, clock, patient, onRespond }: { offer: Offer; run: Run } & Props) {
  const a = appts.find(x => x.id === run.apptId)!;
  const prov = providerById[a.provider];
  if (offer.response === 'accepted') {
    return (
      <div className="offer-card done">
        <span className="pill filled">Booked</span>
        <div className="offer-title">Today, {fmtTime(a.startMin)}</div>
        <div>{CATEGORY_LABEL[a.category]} with {prov.name} · {clinicById[a.clinic].name}</div>
        {patient.nextBookingInDays && <p className="muted">Your {dayLabel(patient.nextBookingInDays)} visit was released for someone else.</p>}
        <div className="appt-actions"><button className="secondary sm">Get directions</button><button className="secondary sm">Add to calendar</button></div>
      </div>
    );
  }
  if (offer.response !== 'pending') return null;
  const frac = Math.max(0, (offer.deadline - clock) / (offer.deadline - offer.sentAt));
  return (
    <div className="offer-card">
      <div className="flex"><span className="pill accent"><Icon name="zap" size={12} />Earlier slot for you</span><span className="muted small">Matches your saved care plan</span></div>
      <div className="offer-title">Today, {fmtTime(a.startMin)}</div>
      <div><b>{CATEGORY_LABEL[a.category]}</b> with {prov.name} · {a.duration} min</div>
      <div className="muted">{clinicById[a.clinic].name} · about {offer.candidate.travelMin} min away</div>
      {patient.nextBookingInDays && <p className="small">Moves you up from <b>{dayLabel(patient.nextBookingInDays)}</b>, {patient.nextBookingInDays} days sooner.</p>}
      <div className="countdown"><div style={{ width: `${frac * 100}%` }} /></div>
      <div className="muted small">Held for you for {Math.max(0, Math.ceil(offer.deadline - clock))} more min · first to accept gets it</div>
      <div className="offer-actions">
        <button className="secondary" onClick={() => onRespond(run.apptId, patient.id, false)}>No thanks</button>
        <button onClick={() => onRespond(run.apptId, patient.id, true)}>Accept appointment</button>
      </div>
    </div>
  );
}

function Home(props: Props) {
  const { patient: p, runs, setTab } = props;
  const offers = findOffers(p, runs);
  const active = offers.find(x => x.offer.response === 'pending') ?? offers.find(x => x.offer.response === 'accepted');
  const recs = useMemo(() => recommend(p), [p]);
  const accepted = offers.find(x => x.offer.response === 'accepted');
  return (
    <div className="patient-layout">
      <div className="stack">
        <div className="patient-hero">
          <div className="eyebrow">Your care, your timing</div>
          <h2>Hello, {p.name.split(' ')[0]}</h2>
          <p className="muted" style={{ fontSize: 14 }}>{accepted ? 'You are booked in today. See you soon.' : p.flexMode || p.freeToday ? 'Earlier-slot offers are on. We will ping you when a better time opens up.' : 'Turn on earlier-slot offers to get seen sooner.'}</p>
          <div className="quick-actions">
            <button className="secondary" onClick={() => setTab('find')}><span className="row" style={{ gap: 6 }}><Icon name="search" />Find care</span></button>
            <button className="secondary" onClick={() => setTab('appointments')}><span className="row" style={{ gap: 6 }}><Icon name="calendar" />My appointments</span></button>
            <button className="secondary" onClick={() => setTab('notifications')}><span className="row" style={{ gap: 6 }}><Icon name="bell" />Notifications</span></button>
          </div>
        </div>
        <section className="card">
          <h2>What's next</h2>
          {active ? <OfferCard {...props} offer={active.offer} run={active.run} /> : (
            <div className="blank">No new offers right now. When a clinic has a cancellation that fits you, it shows up here and on your phone.</div>
          )}
        </section>
        <section className="card">
          <div className="flex"><h2>Recommended for you</h2><button className="link" onClick={() => setTab('find')}>See all →</button></div>
          <p className="muted" style={{ marginTop: -6 }}>Based on your {CATEGORY_LABEL[p.need.category].toLowerCase()} care plan, location and language.</p>
          {recs.map(({ l, d, why }) => (
            <div key={l.id} className="provider-card">
              <div className={`avatar ${l.kind === 'clinic' ? 'clinic' : ''}`}>{initials(l.name)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{l.name}</div>
                <div className="muted small">{l.subtitle} · {d.km.toFixed(1)} km</div>
                <div className="chips">{why.slice(0, 3).map(w => <span key={w} className="chip">{w}</span>)}</div>
              </div>
              <button className="secondary sm">View</button>
            </div>
          ))}
        </section>
      </div>
      <div className="stack">
        <section className="card">
          <h2>Next appointment</h2>
          <UpcomingList {...props} compact />
          <button className="link" onClick={() => setTab('appointments')}>All appointments →</button>
        </section>
        <section className="card">
          <h2>Get seen sooner</h2>
          <div className="toggle-row"><div><b>Offer me earlier slots</b><div className="muted small">{p.flexMode ? Object.entries(p.windows).filter(([, v]) => v).map(([k]) => k).join(', ') : 'Off'}</div></div><span className={`switch ${p.flexMode ? 'on' : ''}`} /></div>
          <div className="toggle-row"><div><b>I'm free today</b><div className="muted small">Expires at midnight</div></div><span className={`switch ${p.freeToday ? 'on' : ''}`} /></div>
          <div className="toggle-row"><div><b>Max travel</b><div className="muted small">Only offers you can reach in time</div></div><span className="pill accent">30 min</span></div>
          <button className="link" onClick={() => setTab('preferences')}>Edit preferences →</button>
        </section>
        <section className="card">
          <h2>My care plan</h2>
          <p><b>{CATEGORY_LABEL[p.need.category]}</b> · {p.need.duration} min visits</p>
          <p className="muted">With {providerById[p.provider].name} at {clinicById[p.homeClinic].name}{p.need.payer !== 'private' ? ` · ${p.need.payer} claim on file` : ''}</p>
          <p className="muted">{p.history.visits} visits so far</p>
        </section>
      </div>
    </div>
  );
}

function UpcomingList({ patient: p, runs, appts, compact }: Props & { compact?: boolean }) {
  const accepted = findOffers(p, runs).find(x => x.offer.response === 'accepted');
  const a = accepted ? appts.find(x => x.id === accepted.run.apptId) : undefined;
  const items: { key: string; days: number; time: number; cat: Category; prov: string; clinic: string; status: string; moved?: boolean }[] = [];
  if (a) items.push({ key: 'today', days: 0, time: a.startMin, cat: a.category, prov: a.provider, clinic: a.clinic, status: 'Confirmed' });
  if (p.nextBookingInDays) items.push({ key: 'next', days: p.nextBookingInDays, time: usualTime(p), cat: p.need.category, prov: p.provider, clinic: p.homeClinic, status: a ? 'Released' : 'Confirmed', moved: !!a });
  if (!items.length) return <div className="blank">No upcoming appointments. You are on the waitlist for {CATEGORY_LABEL[p.need.category].toLowerCase()}.</div>;
  return (
    <>
      {items.slice(0, compact ? 1 : 5).map(it => {
        const d = dateParts(it.days);
        return (
          <div key={it.key} className={`appt-card ${it.moved ? 'moved' : ''}`}>
            <div className="date-tile"><small>{d.mon}</small><b>{d.day}</b></div>
            <div style={{ minWidth: 0 }}>
              <div className="flex"><strong>{CATEGORY_LABEL[it.cat]} · {fmtTime(it.time)}</strong><span className={`pill ${it.moved ? 'bad' : 'filled'}`}>{it.status}</span></div>
              <div className="muted">{it.days === 0 ? 'Today' : d.wd} · {providerById[it.prov].name} · {clinicById[it.clinic].short}</div>
              {it.moved && <div className="muted small">Moved up to today. This time went to another patient.</div>}
              {!compact && !it.moved && (
                <div className="appt-actions">
                  <button className="secondary sm"><span className="row" style={{ gap: 5 }}><Icon name="pin" size={13} />Directions</span></button>
                  <button className="secondary sm"><span className="row" style={{ gap: 5 }}><Icon name="calendar" size={13} />Add to calendar</span></button>
                  <button className="secondary sm">Reschedule</button>
                  <button className="ghost sm">Cancel</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Appointments(props: Props) {
  const p = props.patient;
  const past = [p.history.daysSinceLastVisit, p.history.daysSinceLastVisit + 14, p.history.daysSinceLastVisit + 29].slice(0, Math.min(3, p.history.visits));
  return (
    <div className="patient-layout">
      <section className="card">
        <div className="flex"><h2>Upcoming</h2><span className="muted small">Accepted offers appear here right away</span></div>
        <UpcomingList {...props} />
      </section>
      <div className="stack">
        <section className="card">
          <h2>Past visits</h2>
          {past.map((days, i) => {
            const d = dateParts(-days);
            return (
              <div key={i} className="list-row">
                <div><strong>{CATEGORY_LABEL[p.need.category]} · {providerById[p.provider].name}</strong><div className="muted">{d.wd}, {d.mon} {d.day} · {clinicById[p.homeClinic].short}</div></div>
                <span className="pill">Completed</span>
              </div>
            );
          })}
        </section>
        <section className="card">
          <h2>Offer history</h2>
          {findOffers(p, props.runs).length ? findOffers(p, props.runs).map(({ offer, run }) => {
            const a = props.appts.find(x => x.id === run.apptId)!;
            return <div key={run.apptId} className="list-row"><div><strong>Today {fmtTime(a.startMin)} · {CATEGORY_LABEL[a.category]}</strong><div className="muted">Offered at {fmtTime(offer.sentAt)}</div></div><span className={`pill ${offer.response}`}>{offer.response === 'pending' ? 'Waiting' : offer.response}</span></div>;
          }) : <div className="blank">No offers yet.</div>}
        </section>
      </div>
    </div>
  );
}

function Notifications(props: Props) {
  const { patient: p, runs, appts, seenAt, setTab } = props;
  const list = notificationsFor(p, runs, appts);
  const [channels, setChannels] = useState({ push: true, sms: true, email: false, quiet: true });
  return (
    <div className="patient-layout">
      <section className="card">
        <div className="flex"><h2>Notifications</h2><span className="muted small">{list.filter(n => n.at > seenAt).length} new</span></div>
        {list.map(n => (
          <div key={n.id} className={`notif ${n.at > seenAt ? 'unread' : ''}`}>
            <div className={`notif-icon ${n.tone}`}><Icon name={n.icon} size={18} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="notif-title">{n.title}</div>
              <div className="muted">{n.body}</div>
              {n.offer && n.offer.response === 'pending' && <button className="sm" style={{ marginTop: 8 }} onClick={() => setTab('home')}>Review offer</button>}
            </div>
            <span className="muted small">{n.when}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>How we contact you</h2>
        {([['push', 'App notifications', 'Instant, best for same-day offers'], ['sms', 'Text message', 'Backup when the app is closed'], ['email', 'Email', 'Confirmations and receipts'], ['quiet', 'Quiet hours 9 PM to 7 AM', 'No offers overnight']] as const).map(([k, t, d]) => (
          <div key={k} className="toggle-row">
            <div><b>{t}</b><div className="muted small">{d}</div></div>
            <button className={`switch ${channels[k] ? 'on' : ''}`} aria-pressed={channels[k]} aria-label={t} onClick={() => setChannels({ ...channels, [k]: !channels[k] })} />
          </div>
        ))}
        <p className="muted small" style={{ marginTop: 12 }}>Offers never include your diagnosis, only the clinic, time and service.</p>
      </section>
    </div>
  );
}

function FindCare({ patient: p }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>(p.need.category);
  const [flags, setFlags] = useState({ today: false, lang: false, billing: false, partner: false });
  const results = LISTINGS
    .filter(l => cat === 'all' || l.categories.includes(cat))
    .filter(l => !q || `${l.name} ${l.subtitle}`.toLowerCase().includes(q.toLowerCase()))
    .filter(l => !flags.lang || l.languages.includes(p.language))
    .filter(l => !flags.billing || l.directBilling)
    .filter(l => !(flags.partner || flags.today) || l.partner)
    .map(l => ({ l, d: listingDistance(l, p) }))
    .sort((a, b) => a.d.km - b.d.km);
  // map projection for the mini map
  const lats = [p.lat, ...results.map(r => r.l.lat)], lngs = [p.lng, ...results.map(r => r.l.lng)];
  const [la0, la1, lo0, lo1] = [Math.min(...lats) - 0.01, Math.max(...lats) + 0.01, Math.min(...lngs) - 0.02, Math.max(...lngs) + 0.02];
  const X = (lng: number) => 6 + ((lng - lo0) / (lo1 - lo0 || 1)) * 88;
  const Y = (lat: number) => 12 + (1 - (lat - la0) / (la1 - la0 || 1)) * 80;
  const cats: (Category | 'all')[] = ['all', 'physio', 'massage', 'chiro', 'acupuncture'];
  return (
    <div className="stack">
      <section className="card">
        <div className="search-bar">
          <Icon name="search" />
          <input id="clinic-search" type="search" placeholder="Search clinics, practitioners or services" value={q} onChange={e => setQ(e.target.value)} aria-label="Search clinics" />
          <button className="sm">Search</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {cats.map(c => <button key={c} className={`pick ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c === 'all' ? 'All care' : CATEGORY_LABEL[c]}</button>)}
          <span style={{ width: 8 }} />
          <button className={`pick ${flags.today ? 'on' : ''}`} onClick={() => setFlags({ ...flags, today: !flags.today })}>Openings today</button>
          {p.language !== 'English' && <button className={`pick ${flags.lang ? 'on' : ''}`} onClick={() => setFlags({ ...flags, lang: !flags.lang })}>Speaks {p.language}</button>}
          <button className={`pick ${flags.billing ? 'on' : ''}`} onClick={() => setFlags({ ...flags, billing: !flags.billing })}>Direct billing</button>
          <button className={`pick ${flags.partner ? 'on' : ''}`} onClick={() => setFlags({ ...flags, partner: !flags.partner })}>Earlier-slot offers</button>
        </div>
      </section>
      <div className="patient-layout">
        <section className="card">
          <div className="flex"><h2>{results.length} results near you</h2><span className="muted small">Sorted by distance</span></div>
          {results.map(({ l, d }) => (
            <div key={l.id} className="provider-card">
              <div className={`avatar ${l.kind === 'clinic' ? 'clinic' : ''}`}>{initials(l.name)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{l.name}</div>
                <div className="muted small">{l.subtitle}</div>
                <div className="chips">
                  <span className="chip">{d.km.toFixed(1)} km · {d.min} min</span>
                  {l.partner && <span className="chip">Earlier-slot offers</span>}
                  {l.directBilling && <span className="chip">Direct billing</span>}
                  {l.newPatients && <span className="chip">New patients</span>}
                  {l.languages.filter(x => x !== 'English').slice(0, 2).map(x => <span key={x} className="chip">{x}</span>)}
                </div>
              </div>
              <button className="secondary sm">{l.partner ? 'Book' : 'View'}</button>
            </div>
          ))}
          {!results.length && <div className="blank">No matches. Try another service or clear filters.</div>}
        </section>
        <section className="card">
          <h2>Map</h2>
          <div className="map-box">
            <div className="map-river" />
            {results.slice(0, 7).map(({ l }) => <div key={l.id} className="map-pin" style={{ left: `${X(l.lng)}%`, top: `${Y(l.lat)}%` }}>{l.name.split(' ')[0]}</div>)}
            <div className="map-pin me" style={{ left: `${X(p.lng)}%`, top: `${Y(p.lat)}%` }}>You</div>
          </div>
          <p className="muted small">Illustrative map. Listings marked with earlier-slot offers can send you same-day openings.</p>
        </section>
      </div>
    </div>
  );
}

function Preferences({ patient: p }: Props) {
  const [win, setWin] = useState(p.windows);
  const [days, setDays] = useState<number[]>(p.days);
  const [travel, setTravel] = useState(30);
  const [cap, setCap] = useState(5);
  const [any, setAny] = useState(p.acceptsOtherProviders);
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="patient-layout">
      <section className="card">
        <h2>When can you come in?</h2>
        <div className="eyebrow" style={{ margin: '6px 0 8px' }}>Times of day</div>
        <div className="row">{(['morning', 'afternoon', 'evening'] as const).map(w => <button key={w} className={`pick ${win[w] ? 'on' : ''}`} onClick={() => setWin({ ...win, [w]: !win[w] })}>{w[0].toUpperCase() + w.slice(1)}</button>)}</div>
        <div className="eyebrow" style={{ margin: '16px 0 8px' }}>Days</div>
        <div className="row">{DAYS.map((d, i) => <button key={d} className={`pick ${days.includes(i) ? 'on' : ''}`} onClick={() => setDays(days.includes(i) ? days.filter(x => x !== i) : [...days, i])}>{d}</button>)}</div>
        <label className="slider" htmlFor="pref-travel">Maximum travel time: {travel} min<input id="pref-travel" type="range" min="10" max="60" step="5" value={travel} onChange={e => setTravel(+e.target.value)} /></label>
        <label className="slider" htmlFor="pref-cap">At most {cap} offers a week<input id="pref-cap" type="range" min="1" max="10" value={cap} onChange={e => setCap(+e.target.value)} /></label>
      </section>
      <section className="card">
        <h2>Who you'll see</h2>
        <div className="toggle-row"><div><b>Only {providerById[p.provider].name}</b><div className="muted small">Turn off to also get offers from other practitioners</div></div><button className={`switch ${!any ? 'on' : ''}`} aria-label="Only my practitioner" onClick={() => setAny(!any)} /></div>
        <div className="toggle-row"><div><b>Preferred language</b><div className="muted small">Ranks practitioners who speak it higher</div></div><span className="pill accent">{p.language}</span></div>
        <div className="toggle-row"><div><b>Clinics</b><div className="muted small">{clinicById[p.homeClinic].name} and nearby partners</div></div><span className="pill">2 selected</span></div>
        <button style={{ marginTop: 14 }}>Save preferences</button>
      </section>
    </div>
  );
}
