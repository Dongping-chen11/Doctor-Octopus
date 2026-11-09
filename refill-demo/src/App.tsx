import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from './engine/match';
import { patientById, patients, providerById } from './engine/data';
import type { Settings } from './engine/types';
import { cancelAppt, initialSim, nextScriptedCancellation, openRun, rank, respond, sendWave, tick, type Flags, type Sim } from './sim';
import { Impact } from './components/Impact';
import { HowItWorks } from './components/HowItWorks';
import { Icon, LogoMark } from './components/Icon';
import { Dashboard } from './clinic/Dashboard';
import { ClinicSchedule } from './clinic/ClinicSchedule';
import { Recovery } from './clinic/Recovery';
import { findOffers, notificationsFor, PatientApp, type PatientTab } from './patient/PatientApp';
import { CATEGORY_LABEL, DEMO_DAY_LABEL, fmtTime } from './util';

type Portal = 'clinic' | 'patient';
type ClinicTab = 'dashboard' | 'schedule' | 'recovery' | 'insights' | 'model';

const CLINIC_TABS: [ClinicTab, string, string][] = [
  ['dashboard', 'Dashboard', 'grid'], ['schedule', 'Schedule', 'calendar'], ['recovery', 'Appointment recovery', 'refresh'],
  ['insights', 'Insights', 'chart'], ['model', 'Model & settings', 'sliders'],
];
const PATIENT_TABS: [PatientTab, string, string][] = [
  ['home', 'Home', 'home'], ['find', 'Find care', 'search'], ['notifications', 'Notifications', 'bell'],
  ['appointments', 'My appointments', 'calendar'], ['preferences', 'Preferences', 'user'],
];
const DEFAULT_PERSONA = patients.find(p => !p.optedOut && p.flexMode && p.nextBookingInDays)?.id ?? patients[0].id;

export default function App() {
  const [portal, setPortal] = useState<Portal>('clinic');
  const [ctab, setCtab] = useState<ClinicTab>('dashboard');
  const [ptab, setPtab] = useState<PatientTab>('home');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sim, setSim] = useState<Sim>(initialSim);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1); // demo minutes per real second
  const [flags, setFlags] = useState<Flags>({ autopilot: false, scripted: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState<string>(DEFAULT_PERSONA);
  const [personaQuery, setPersonaQuery] = useState('');
  const [seenAt, setSeenAt] = useState(-Infinity);
  const [toastFor, setToastFor] = useState<string | null>(null);
  const seenOffers = useRef(new Set<string>());
  const live = useRef({ settings, flags, speed, running });
  live.current = { settings, flags, speed, running };

  useEffect(() => {
    const id = setInterval(() => {
      const l = live.current;
      if (!l.running) return;
      setSim(s => (s.clock >= 18 * 60 + 30 ? s : tick(s, l.speed * 0.25, l.settings, l.flags)));
    }, 250);
    return () => clearInterval(id);
  }, []);

  // The patient app follows whoever got the top (hand-picked) offer, so the demo phone always has something to show.
  useEffect(() => {
    if (sim.phonePatientId) { setPersonaId(sim.phonePatientId); setSeenAt(-Infinity); }
  }, [sim.phonePatientId]);

  const persona = patientById[personaId];
  const offers = findOffers(persona, sim.runs);
  const pendingOffer = offers.find(o => o.offer.response === 'pending');

  // Push-style toast whenever a new offer lands for the person we are acting as.
  useEffect(() => {
    if (!pendingOffer) return;
    const key = `${pendingOffer.run.apptId}:${persona.id}`;
    if (seenOffers.current.has(key)) return;
    seenOffers.current.add(key);
    setToastFor(key);
  }, [pendingOffer, persona.id]);
  useEffect(() => {
    if (!pendingOffer && toastFor) setToastFor(null);
  }, [pendingOffer, toastFor]);

  const notices = notificationsFor(persona, sim.runs, sim.appts);
  const unread = notices.filter(n => n.at > seenAt).length;
  const goPatientTab = (t: PatientTab) => {
    setPtab(t);
    if (t === 'notifications') setSeenAt(sim.clock);
  };
  useEffect(() => {
    if (portal === 'patient' && ptab === 'notifications') setSeenAt(sim.clock);
  }, [portal, ptab, notices.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = sim.appts.find(a => a.id === selectedId) ?? null;
  const match = useMemo(() => (selected ? rank(sim, settings, selected) : null), [selected, sim, settings]);

  const openRecovery = (id: string) => { setSelectedId(id); setSim(s => openRun(s, id)); setCtab('recovery'); };
  const simulateCancel = () => {
    const a = nextScriptedCancellation(sim);
    if (!a) return;
    setSim(s => cancelAppt(s, a.id));
    setSelectedId(a.id);
    setCtab('recovery');
  };
  const openPatient = (pid: string) => { setPersonaId(pid); setPortal('patient'); goPatientTab('home'); };
  const onRespond = (apptId: string, pid: string, accept: boolean) => {
    setSim(s => respond(s, apptId, pid, accept));
    setToastFor(null);
  };

  const recoveryCount = Object.values(sim.runs).filter(r => r.status === 'waiting').length
    + sim.appts.filter(a => a.state === 'cancelled' && !sim.runs[a.id]).length;
  const personaMatches = useMemo(() => {
    const q = personaQuery.trim().toLowerCase();
    const base = q ? patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : patients.filter(p => !p.optedOut).slice(0, 40);
    const list = base.slice(0, 40);
    return list.some(p => p.id === personaId) ? list : [persona, ...list];
  }, [personaQuery, personaId, persona]);

  const toastAppt = pendingOffer ? sim.appts.find(a => a.id === pendingOffer.run.apptId) : undefined;
  const toastLeft = pendingOffer ? Math.max(0, Math.ceil(pendingOffer.offer.deadline - sim.clock)) : 0;

  return (
    <div className={portal === 'clinic' ? 'portal-clinic' : 'portal-patient'}>
      <header className="top">
        <div className="brand">
          <span className="brand-mark"><LogoMark /></span>
          <div>Doctor Octopus<small>{portal === 'clinic' ? 'Clinic portal · short-notice slot recovery' : 'Patient app · get seen sooner'}</small></div>
        </div>
        <div className="top-right">
          <div className="portal-switch" role="tablist" aria-label="Portal">
            <button className={portal === 'clinic' ? 'on' : ''} onClick={() => setPortal('clinic')}>Clinic portal</button>
            <button className={portal === 'patient' ? 'on' : ''} onClick={() => setPortal('patient')}>Patient app</button>
          </div>
          <div className="clock" title="Demo clock">
            <span>{DEMO_DAY_LABEL}</span>
            <b>{fmtTime(sim.clock)}</b>
            <button onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Play'}</button>
            <select value={speed} onChange={e => setSpeed(+e.target.value)} aria-label="Demo speed">
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={3}>3×</option>
              <option value={10}>10×</option>
            </select>
          </div>
        </div>
      </header>

      <nav className="nav">
        {portal === 'clinic'
          ? CLINIC_TABS.map(([t, label, icon]) => (
            <button key={t} className={ctab === t ? 'active' : ''} onClick={() => setCtab(t)}>
              <Icon name={icon} size={16} />{label}{t === 'recovery' && recoveryCount > 0 && <span className="badge">{recoveryCount}</span>}
            </button>
          ))
          : PATIENT_TABS.map(([t, label, icon]) => (
            <button key={t} className={ptab === t ? 'active' : ''} onClick={() => goPatientTab(t)}>
              <Icon name={icon} size={16} />{label}{t === 'notifications' && unread > 0 && <span className="badge">{unread}</span>}
            </button>
          ))}
      </nav>

      <main>
        {portal === 'clinic' ? (
          <>
            {ctab !== 'insights' && ctab !== 'model' && (
              <div className="hero">
                <div>
                  <div className="eyebrow">Bethesda + Revive · {DEMO_DAY_LABEL}</div>
                  <h1>{ctab === 'dashboard' ? 'Front desk overview' : ctab === 'schedule' ? 'Today’s schedule' : 'Appointment recovery'}</h1>
                  <p className="muted">{ctab === 'recovery' ? 'Every cancelled or open slot, the patients who can take it, and the offers going out.' : 'Cancellations are matched to waiting patients automatically. Staff stay in control.'}</p>
                </div>
                <div className="row">
                  <label className="toggle" title="For a smooth live demo">
                    <input type="checkbox" checked={flags.scripted} onChange={e => setFlags({ ...flags, scripted: e.target.checked })} /> Demo script
                  </label>
                  <button className="ghost sm" onClick={() => { setSim(initialSim()); setSelectedId(null); seenOffers.current.clear(); setPersonaId(DEFAULT_PERSONA); }}>Reset day</button>
                </div>
              </div>
            )}
            {ctab === 'dashboard' && <Dashboard appts={sim.appts} runs={sim.runs} log={sim.log} clock={sim.clock} onOpenRecovery={openRecovery} onGoSchedule={() => setCtab('schedule')} onSimulate={simulateCancel} />}
            {ctab === 'schedule' && (
              <ClinicSchedule
                appts={sim.appts} runs={sim.runs} clock={sim.clock} selectedId={selectedId}
                onSelect={setSelectedId}
                onCancel={(id, kind) => { setSim(s => cancelAppt(s, id, kind)); setSelectedId(id); }}
                onOpenRecovery={openRecovery}
                onSimulate={simulateCancel}
              />
            )}
            {ctab === 'recovery' && (
              <Recovery
                appts={sim.appts} runs={sim.runs} selected={selected} match={match} clock={sim.clock} settings={settings}
                autopilot={flags.autopilot}
                onSelect={id => { setSelectedId(id); setSim(s => openRun(s, id)); }}
                onSendWave={() => selected && setSim(s => sendWave(s, selected.id, settings, flags))}
                onAutopilot={v => setFlags({ ...flags, autopilot: v })}
                onOpenPatient={openPatient}
                onGoSchedule={() => setCtab('schedule')}
              />
            )}
            {ctab === 'insights' && <Impact settings={settings} />}
            {ctab === 'model' && <HowItWorks settings={settings} setSettings={setSettings} />}
          </>
        ) : (
          <>
            <div className="hero">
              <div>
                <div className="eyebrow">Patient app preview</div>
                <h1>What {persona.name.split(' ')[0]} sees on their phone</h1>
                <p className="muted">Offers from the clinic portal arrive here live. Accept one and it books straight into the clinic’s schedule.</p>
              </div>
              <div className="persona">
                <label htmlFor="persona-search">Acting as</label>
                <div className="row">
                  <input id="persona-search" type="search" placeholder="Search patients" value={personaQuery} onChange={e => setPersonaQuery(e.target.value)} style={{ flex: '1 1 120px', minWidth: 0 }} />
                  <select value={personaId} onChange={e => { setPersonaId(e.target.value); setSeenAt(-Infinity); }} aria-label="Patient" style={{ flex: '2 1 160px', minWidth: 0 }}>
                    {personaMatches.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === sim.phonePatientId ? ' (has an offer)' : ''}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <PatientApp patient={persona} runs={sim.runs} appts={sim.appts} clock={sim.clock} tab={ptab} setTab={goPatientTab} onRespond={onRespond} seenAt={seenAt} />
          </>
        )}
      </main>

      {toastFor && pendingOffer && toastAppt && !(portal === 'patient' && ptab === 'home') && (
        <div className="toast portal-patient" role="status">
          <span className="notif-icon"><Icon name="bell" size={18} /></span>
          <div>
            <strong>Earlier appointment for {persona.name.split(' ')[0]}</strong>
            <div className="muted small">{CATEGORY_LABEL[toastAppt.category]} with {providerById[toastAppt.provider].name}, today {fmtTime(toastAppt.startMin)} · {toastLeft} min to answer</div>
            <div className="row">
              <button className="sm" onClick={() => { setPortal('patient'); goPatientTab('home'); setToastFor(null); }}>View offer</button>
              <button className="secondary sm" onClick={() => setToastFor(null)}>Later</button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">Doctor Octopus prototype for natHacks 2026. Schedules and histories come from two Edmonton clinics’ anonymized exports; names, locations, availability and the extra directory clinics are mock.</footer>
    </div>
  );
}
