import { model, patients, providers, history } from '../engine/data';
import type { Settings } from '../engine/types';

const FEATURE_LABEL: Record<string, string> = {
  prior_rate: 'Patient’s past cancel rate', online: 'Booked online', log_lead: 'Days booked ahead (log)', first: 'First visit',
  evening: 'Evening slot', morning: 'Morning slot', saturday: 'Saturday', cat_massage: 'Massage', cat_chiro: 'Chiro',
  cat_aesthetics: 'Aesthetics', cat_acupuncture: 'Acupuncture', insurance: 'Insurance plan (MVA, WCB)',
};

interface Props { settings: Settings; setSettings: (s: Settings) => void }

export function HowItWorks({ settings, setSettings }: Props) {
  const coefs = Object.entries(model.coef).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const maxC = Math.max(...coefs.map(c => Math.abs(c[1])));
  const w = settings.weights;
  const setW = (k: keyof Settings['weights'], v: number) => setSettings({ ...settings, weights: { ...w, [k]: v } });
  return (
    <div className="how">
      <div className="steps">
        {[
          ['1', 'Slot opens', 'A cancellation or no-show frees a provider’s time. The engine starts within seconds.'],
          ['2', 'Recoverability', 'Estimates the chance the slot gets filled, from time left and the candidate pool, next to what staff achieve by hand.'],
          ['3', 'Hard filters', 'Service the provider gives, slot length, acceptable provider and clinic, not double booked, free at that time, can get there in time, under the weekly offer cap.'],
          ['4', 'Score and rank', 'P(accept) × P(show) × value, where value weighs fit, clinical need and wait time. Every match shows its reasons.'],
          ['5', 'Offer waves', 'Smallest group whose chance of one acceptance reaches the target; shorter timers and bigger waves as the slot nears. First to accept wins.'],
          ['6', 'Book and chain', 'Booking goes through the clinic’s existing system. The patient’s later booking is released and matched for someone else.'],
        ].map(([n, t, d]) => (
          <div key={n} className="step"><div className="step-n">{n}</div><div><b>{t}</b><p className="muted small">{d}</p></div></div>
        ))}
      </div>

      <div className="how-grid">
        <div className="panel">
          <h3>Show-up model (trained on real visits)</h3>
          <p className="small muted">Logistic regression on {model.trainedOn.toLocaleString()} real appointments from both clinics, predicting cancel or no-show. AUC {model.testAuc} on the latest 20% of dates (held out). Base rate {Math.round(model.baseRate * 100)}%.</p>
          {coefs.map(([k, v]) => (
            <div key={k} className="coef-row">
              <span>{FEATURE_LABEL[k] ?? k}</span>
              <div className="coef-bar"><div className={v > 0 ? 'neg' : 'pos'} style={{ width: `${(Math.abs(v) / maxC) * 50}%`, [v > 0 ? 'left' : 'right']: '50%' }} /></div>
              <b>{v > 0 ? '+' : ''}{v.toFixed(2)}</b>
            </div>
          ))}
          <p className="small muted">Right of centre = more likely to cancel. Sex, gender and other protected fields are never used.</p>
        </div>

        <div className="panel">
          <h3>Tune the ranking</h3>
          <label className="slider">Fit (provider, time, language, distance): {w.fit.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={w.fit} onChange={e => setW('fit', +e.target.value)} /></label>
          <label className="slider">Clinical need: {w.need.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={w.need} onChange={e => setW('need', +e.target.value)} /></label>
          <label className="slider">Wait time (fairness): {w.wait.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={w.wait} onChange={e => setW('wait', +e.target.value)} /></label>
          <label className="slider">Offers per patient per week: {settings.fatigueCap}<input type="range" min="1" max="10" step="1" value={settings.fatigueCap} onChange={e => setSettings({ ...settings, fatigueCap: +e.target.value })} /></label>
          <label className="slider">Travel buffer: {settings.travelBuffer} min<input type="range" min="0" max="45" step="5" value={settings.travelBuffer} onChange={e => setSettings({ ...settings, travelBuffer: +e.target.value })} /></label>
          <label className="toggle"><input type="checkbox" checked={settings.crossClinic} onChange={e => setSettings({ ...settings, crossClinic: e.target.checked })} /> Offer slots across both clinics</label>
          <p className="small muted">Changes apply live to the console and the replay.</p>

          <h3>Data behind the demo</h3>
          <ul className="small">
            <li>Real: {providers.length} providers, their services and durations; {patients.length} active patients’ visit and cancel histories; {history.length.toLocaleString()} real cancellations and whether staff refilled them.</li>
            <li>Mock: names, home locations, availability windows, upcoming bookings, waitlist days, language, past offer answers, clinic locations, and today’s schedule.</li>
            <li>Fairness guards: wait time grows priority, weekly offer cap, “too late” credit, staff review mode, no protected attributes.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
