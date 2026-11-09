import { useMemo, useState } from 'react';
import { baseline, clinicById, dataRange, history, model, patients, providerById } from '../engine/data';
import { DEFAULT_REPLAY, replay } from '../engine/replay';
import type { Settings } from '../engine/types';
import { pct } from '../util';

export function Impact({ settings }: { settings: Settings }) {
  const [haircut, setHaircut] = useState(DEFAULT_REPLAY.acceptHaircut);
  const [maxWaves, setMaxWaves] = useState(DEFAULT_REPLAY.maxWaves);
  const r = useMemo(
    () => replay(history, patients, baseline, { clinics: clinicById, providers: providerById, model, settings }, { ...DEFAULT_REPLAY, acceptHaircut: haircut, maxWaves }),
    [settings, haircut, maxWaves],
  );
  const W = 640, H = 260, left = 40, base = 210;
  const band = (W - left) / r.byBucket.length;
  const bw = 34;
  const y = (v: number) => base - v * 170;

  return (
    <div className="impact">
      <div className="impact-head">
        <h2>Replay: last year's real cancellations, with and without matching</h2>
        <p className="muted">{r.rows.toLocaleString()} cancelled or no-show slots at both clinics, {dataRange[0]} to {dataRange[1]}. Slots, providers, timing and real refills come from the exports; the patients who receive offers are mock.</p>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-num">{pct(r.shortNotice.manual / r.shortNotice.n)} → {pct(r.shortNotice.engine / r.shortNotice.n)}</div><div className="kpi-label">short-notice slots filled (under 6 h)</div></div>
        <div className="kpi"><div className="kpi-num">+{Math.round(r.hoursRecovered)} h</div><div className="kpi-label">provider-hours recovered in a year</div></div>
        <div className="kpi"><div className="kpi-num">{r.offersPerFill.toFixed(1)}</div><div className="kpi-label">offers sent per extra slot filled</div></div>
        <div className="kpi"><div className="kpi-num">{Math.round(r.minutesToFill)} min</div><div className="kpi-label">average time to fill</div></div>
        <div className="kpi"><div className="kpi-num">≤ {r.maxOffersPerPatientWeek}</div><div className="kpi-label">offers per patient per week (cap {settings.fatigueCap})</div></div>
      </div>

      <div className="impact-grid">
        <div className="panel">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Fill rate by notice, by hand vs with matching">
            <text x="0" y="16" className="chart-title">Matching lifts the fill rate most where staff struggle: short notice</text>
            {r.byBucket.map((b, i) => {
              const m = b.n ? b.manual / b.n : 0;
              const e = b.n ? b.engine / b.n : 0;
              const x0 = left + i * band + band / 2 - bw - 2;
              return (
                <g key={b.label}>
                  <rect x={x0} y={y(m)} width={bw} height={base - y(m)} className="bar-manual" rx="2"><title>{`${b.label}: ${pct(m)} by hand`}</title></rect>
                  <text x={x0 + bw / 2} y={y(m) - 5} className="bar-val">{pct(m)}</text>
                  <rect x={x0 + bw + 4} y={y(e)} width={bw} height={base - y(e)} className="bar-engine" rx="2"><title>{`${b.label}: ${pct(e)} with matching`}</title></rect>
                  <text x={x0 + bw + 4 + bw / 2} y={y(e) - 5} className="bar-val strong">{pct(e)}</text>
                  <text x={left + i * band + band / 2} y={base + 18} className="axis-label">{b.label}</text>
                  <text x={left + i * band + band / 2} y={base + 33} className="axis-sub">n = {b.n}</text>
                </g>
              );
            })}
            <line x1={left} x2={W} y1={base} y2={base} className="axis" />
            <g transform={`translate(${W - 230}, 30)`}>
              <rect width="12" height="12" className="bar-manual" rx="2" /><text x="18" y="10" className="legend">By hand (real)</text>
              <rect x="120" width="12" height="12" className="bar-engine" rx="2" /><text x="138" y="10" className="legend">With matching</text>
            </g>
          </svg>
        </div>
        <div className="panel side">
          <h3>Who got the recovered slots</h3>
          <div className="need-bars">
            {([['Acute (clinic flag)', r.fillsByNeed.acute], ['Insurance plans (MVA, WCB)', r.fillsByNeed.insurance], ['Waitlist, no booking yet', r.fillsByNeed.waitlist], ['Moved up from a later booking', r.fillsByNeed.sooner]] as [string, number][]).map(([l, v]) => {
              const tot = r.fillsByNeed.acute + r.fillsByNeed.insurance + r.fillsByNeed.waitlist + r.fillsByNeed.sooner || 1;
              return <div key={l} className="need-row"><span>{l}</span><div className="funnel-bar"><div style={{ width: `${(v / tot) * 100}%` }} /></div><b>{v}</b></div>;
            })}
          </div>
          <p className="small muted">{r.patientsOffered} different patients received at least one offer; {r.offers.toLocaleString()} offers in total.</p>
          <h3>Assumptions you can change</h3>
          <label className="slider">Acceptance realism: {Math.round(haircut * 100)}% of the model's P(accept)
            <input type="range" min="0.2" max="1" step="0.05" value={haircut} onChange={e => setHaircut(+e.target.value)} />
          </label>
          <label className="slider">Max waves per slot: {maxWaves}
            <input type="range" min="1" max="8" step="1" value={maxWaves} onChange={e => setMaxWaves(+e.target.value)} />
          </label>
          <p className="small muted">A slot counts as filled if staff filled it in real life or the engine filled it, because the engine works alongside the front desk. No-shows and slots with under 20 minutes left are never counted as engine fills.</p>
        </div>
      </div>
    </div>
  );
}
