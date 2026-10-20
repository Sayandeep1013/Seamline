# Seamline

A calm perspective puzzle: what looks joined, is joined. The full design is in [`GAME_PLAN.md`](GAME_PLAN.md), and the research on feel and atmosphere is in [`research/FEEL_AND_ATMOSPHERE.md`](research/FEEL_AND_ATMOSPHERE.md).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # rules + level checks
npm run build
```

When run with `npm run dev`, the page exposes `window.__seamline` (state, setStop, release) and `window.__anim` (timeScale) for automated tests.
