# Doctor Octopus demo app

React + TypeScript + Vite. See the [main README](../README.md) for what it does, the results and the repository layout.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (vitest)
npm run build      # production build in dist/
SINGLE=1 npx vite build   # one self-contained dist/index.html
```

`refill-demo-standalone.html` is a prebuilt copy that opens in any browser with no install.

Rebuild the data from the clinic exports (needs pandas and scikit-learn), then rerun the replay:

```bash
python3 scripts/prepare_data.py /path/to/aide_data
npx vite-node scripts/sim_recovery.ts
```
