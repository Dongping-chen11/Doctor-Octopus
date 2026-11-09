import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from './engine/match';
import type { Settings } from './engine/types';
import { cancelAppt, initialSim, nextScriptedCancellation, openRun, rank, respond, sendWave, tick, type Flags, type Sim } from './sim';
import { Schedule } from './components/Schedule';
import { MatchPanel } from './components/MatchPanel';
import { Phone } from './components/Phone';
import { Impact } from './components/Impact';
import { HowItWorks } from './components/HowItWorks';
import { DEMO_DAY_LABEL, fmtTime } from './util';

type Tab = 'live' | 'impact' | 'how';

export default function App() {
  const [tab, setTab] = useState<Tab>('live');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sim, setSim] = useState<Sim>(initialSim);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1); // demo minutes per real second
  const [flags, setFlags] = useState<Flags>({ autopilot: false, scripted: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
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

  const selected = sim.appts.find(a => a.id === selectedId) ?? null;
  const match = useMemo(() => (selected ? rank(sim, settings, selected) : null), [selected, sim, settings]);

  const simulateCancel = () => {
    const a = nextScriptedCancellation(sim);
    if (!a) return;
    setSim(s => cancelAppt(s, a.id));
    setSelectedId(a.id);
  };

  const logTail = sim.log.slice(-6).reverse();

  return (
    <div className="app" onClick={() => menuId && setMenuId(null)}>
      <header className="topbar">
        <div className="brand"><span className="logo-dot" />Refill <span className="muted">short-notice slot matching</span></div>
        <nav>
          {(['live', 'impact', 'how'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t === 'live' ? 'Live console' : t === 'impact' ? 'Impact replay' : 'How it works'}
            </button>
          ))}
        </nav>
        <div className="clock">
          <span className="muted">{DEMO_DAY_LABEL}</span>
          <b>{fmtTime(sim.clock)}</b>
          <button className="ghost sm" onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Play'}</button>
          <select value={speed} onChange={e => setSpeed(+e.target.value)} aria-label="Speed">
            <option value={0.5}>0.5 min/s</option>
            <option value={1}>1 min/s</option>
            <option value={3}>3 min/s</option>
            <option value={10}>10 min/s</option>
          </select>
        </div>
      </header>

      {tab === 'live' && (
        <main className="live">
          <section className="col-schedule panel">
            <div className="panel-head">
              <h3>Today's schedule</h3>
              <div className="row gap">
                <button className="danger" onClick={simulateCancel}>Simulate a cancellation</button>
                <button className="ghost sm" onClick={() => { setSim(initialSim()); setSelectedId(null); }}>Reset</button>
              </div>
            </div>
            <p className="small muted hint">Tap a booked visit to cancel it, or tap an open or cancelled slot to match it.</p>
            <Schedule
              appts={sim.appts}
              runs={sim.runs}
              clock={sim.clock}
              selectedId={selectedId}
              onSelect={id => { setSelectedId(id); setSim(s => openRun(s, id)); }}
              onCancel={(id, kind) => { setSim(s => cancelAppt(s, id, kind)); setSelectedId(id); }}
              menuId={menuId}
              setMenuId={setMenuId}
            />
          </section>

          <section className="col-match">
            {selected && match ? (
              <MatchPanel
                appt={selected}
                run={sim.runs[selected.id]}
                match={match}
                clock={sim.clock}
                settings={settings}
                autopilot={flags.autopilot}
                onAutopilot={v => setFlags({ ...flags, autopilot: v })}
                onSendWave={() => setSim(s => sendWave(s, selected.id, settings, flags))}
              />
            ) : (
              <div className="panel empty">
                <h2>No slot selected</h2>
                <p className="muted">Press <b>Simulate a cancellation</b>, or tap any booked visit and cancel it. The engine finds who is eligible, available and able to get there, ranks them, and offers the slot in timed waves.</p>
              </div>
            )}
            <div className="panel log">
              <h3>Activity</h3>
              {logTail.map((l, i) => (
                <div key={i} className={`log-row k-${l.kind}`}><span className="log-time">{fmtTime(l.at)}</span><span>{l.text}</span></div>
              ))}
              <label className="toggle small"><input type="checkbox" checked={flags.scripted} onChange={e => setFlags({ ...flags, scripted: e.target.checked })} /> Demo script: other patients in wave 1 don’t accept, so the phone can</label>
            </div>
          </section>

          <section className="col-phone">
            <Phone
              patientId={sim.phonePatientId}
              runs={sim.runs}
              appts={sim.appts}
              clock={sim.clock}
              onRespond={(apptId, pid, accept) => setSim(s => respond(s, apptId, pid, accept))}
            />
          </section>
        </main>
      )}
      {tab === 'impact' && <Impact settings={settings} />}
      {tab === 'how' && <HowItWorks settings={settings} setSettings={setSettings} />}
      <footer className="foot muted small">Prototype for the AIDE natHacks 2026 challenge. Schedules and histories come from two Edmonton clinics' anonymized exports; names, locations and availability are mock.</footer>
    </div>
  );
}
