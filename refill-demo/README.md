# Refill: short-notice slot matching (natHacks 2026, AIDE challenge)

A demo of a matching engine that fills cancelled clinic slots. When a slot opens, it filters eligible patients, ranks them by P(accept) × P(show) × value, and offers the slot in small timed waves until someone accepts.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (vitest)
npm run build      # static build in dist/
SINGLE=1 npx vite build   # one self-contained dist/index.html
```

Regenerate the data from the clinic exports (needs pandas and scikit-learn):

```bash
python3 scripts/prepare_data.py /path/to/aide_data
```

## Where things are

| Path | What |
| --- | --- |
| `scripts/prepare_data.py` | Reads both exports. Builds providers, patients (real history + mock fields), real cancellation history with refill flags, and trains the show-up model (logistic regression, AUC 0.725 on a time split). |
| `src/engine/match.ts` | Hard filters, P(accept), P(show), value, score, wave planning, recoverability. Pure functions. |
| `src/engine/replay.ts` | Replays 1,165 real cancellations through the engine with mock patients. |
| `src/engine/match.test.ts` | Engine tests. |
| `src/sim.ts` | Live demo state: clock, cancellations, offer waves, simulated answers. |
| `src/components/` | Schedule, match panel, patient phone, impact replay, how it works. |

## What is real vs mock

Real: providers, services, slot lengths, patient visit and cancel histories, cancellation timing, whether staff refilled each slot, the show-up model.
Mock: names, home and clinic locations, availability windows, "free today", upcoming bookings, waitlist days, language, past offer answers, today's schedule.

## Ideas for Sunday (model work)

- Show-up model: try gradient boosting and calibrate probabilities; add features like weather or days since last visit.
- P(accept) is hand-tuned in `match.ts`. Replace it with a model once real offer logs exist; for the demo, fit it to a simulated offer dataset.
- Calibrate the replay's acceptance realism (Impact tab slider) and report a range rather than one number.

## Demo script (3 minutes)

1. Open on Impact replay: short-notice slots refilled 16% of the time by hand.
2. Live console: press Simulate a cancellation (2:00 PM physio).
3. Walk the funnel and the ranked list; open one row to show the score breakdown.
4. Send wave 1, then tap Accept on the phone. The slot turns green; the patient's later booking is released.
5. Back to Impact replay for hours recovered, offers per fill and the weekly offer cap.
