# Rubberbands & More — frontend

Hold **$RBM**. Get **$1**. Every 5 minutes. Single-page React 19 / Vite 7
site for the Rubberbands & More dispenser (`rubberbands-back`): live
drawer, next-drop countdown, animated how-it-works diagram, paid feed,
and the your-spot-in-line checker, all over the backend's WebSocket,
with an offline demo mode.

> **For the next agent:** no framework beyond React, no UI deps, no
> state library. One component file, one stylesheet. Read "Wiring" and
> "File map" and you know the whole app.

## Deployed state (as of 2026-07-21)

| Thing | Where |
|---|---|
| Production | `https://rubberbands-front.vercel.app` (Vercel project `rubberbands-front`, scope harkor421) |
| Deploy | `vercel deploy --prod --yes` from this directory (CLI logged in) |
| Backend | `wss://rubberbands-back-production.up.railway.app`, baked in as the default; no Vercel env needed |

## Wiring

`src/App.jsx` opens one WebSocket to the backend and consumes five
message types (`service_status`, `holders_update`, `cycle_state`,
`payments_update`, `distribution_result`; shapes documented in the
backend README). If the socket doesn't connect within 1.2s the site
enters **demo mode**: fake holders, a self-refilling pot, a $1 burst
every 45s, so the page always looks alive. Reconnects with backoff;
demo exits the moment the real socket opens.

Env overrides (all optional, Vite-style):

| Var | Default | |
|---|---|---|
| `VITE_WS_URL` | `wss://rubberbands-back-production.up.railway.app` | backend socket |
| `VITE_CA` | — | pin the CA (else it arrives over WS) |
| `VITE_BUY_URL` | `https://www.noxa.fun` | GET $RBM button target |
| `VITE_EXPLORER` | `https://robinhoodchain.blockscout.com` | address/tx links |
| `VITE_TICKER` | `RBM` | display ticker |

## Design system (the whole aesthetic in one place)

Chroma-green claymation office supplies, from the brand art:

- Palette: CSS vars at the top of `src/index.css`. `--green #3ec504`
  backdrop, `--paper #f4eec6` cards, `--teal/#17786a` +
  `--teal-deep/#0d5c50` ink and 3D extrusion, `--yellow #ffd21f` money,
  pin accents `--blue`/`--red`, `--band #e2cb79` rubber tan.
- Type: **Titan One** display (class `.ext`/`.h2`/`.mega-line` adds the
  6-step teal extrusion text-shadow), **Nunito** body, **JetBrains
  Mono** numbers. Loaded in `index.html`.
- Kit: cream sticker cards with 3px teal border + hard offset shadow
  (`--hard`), slight rotations, pushpins on cards, dashed dividers,
  ruled legal-pad background on the feed, googly eyes on everything.
- Copy rule: **no em dashes in visible text** (owner preference); use
  commas or periods.

## File map

```
index.html        fonts, meta, favicon (public/logo.svg)
src/main.jsx      React root
src/index.css     all styling: tokens → sections → diagram (.fig-*) → rain → responsive
src/App.jsx       everything else:
  App             ws + demo mode + derived state + page layout
  FallingBits     low-opacity office-supply rain (fixed layer, z0)
  HowDiagram      the animated mechanic scene (SVG; timings live in CSS @keyframes fig-*)
  Sticker         SVG rect with the hard-offset sticker look
  BandBall        mascot (googly-eyed rubberband ball; bare = no face)
  BandLoop / Pin / Smiley   small props
  SpotResult      the your-spot-in-line card
  Reveal          IntersectionObserver blur-fade (Magic UI style, no deps)
  useNow / useCountUp / fmt* helpers
public/logo.svg   favicon + og mark (swap for rendered art if provided)
```

### The animated diagram (`HowDiagram` + `.fig-*` CSS)

One 9s master loop, all in CSS keyframes so React never re-renders for
it: Ξ coins drip into the drawer (3s stream), the cash level rises, the
5-min dial sweeps, "÷ $1 = N payouts" pops, three $1 bills fly to the
ranked chips (biggest bag first) with "+$1.00" pops, and the dashed #4
chip gets "next round ↻" when the drawer runs dry. Bill flight
coordinates are absolute viewBox translates in `fig-bill1..3`; if you
move chips in the JSX, update those keyframes. Diagram scrolls
horizontally under 780px; reduced-motion gets a static story frame.

### The rain (`FallingBits` + `.rain-*`)

16 hand-placed sprites (bands, pins, clips, erasers, $1 bills) falling
at 10–14% opacity, transform-only, negative delays so it's mid-flight
on load. Thinned to half under 560px, `display:none` under
reduced-motion.

## Dev

```bash
npm i
npm run dev      # local, hits the live backend (or demo mode offline)
npm run build    # dist/
```

Point `VITE_WS_URL` at `ws://localhost:8080` to develop against a local
`DRY_RUN=true` backend.
