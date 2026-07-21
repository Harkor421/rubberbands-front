# Rubberbands & More — frontend

Hold $RBM. Get $1. Every 5 minutes. Single-page React/Vite site for the
Rubberbands & More dispenser (rubberbands-back): live drawer, next-drop
countdown, paid feed, and the your-spot-in-line checker — over the backend's
WebSocket, with an offline demo mode.

Aesthetic: chroma-green claymation office supplies — cream paper cards,
teal 3D-extruded type, pushpins, ruled legal-pad feed, and the googly-eyed
rubberband-ball mascot (inline SVG; drop a rendered `logo-master.png` in
later if you have one).

```bash
npm i
npm run dev     # local
npm run build   # dist/
```

Env (`VITE_WS_URL`, `VITE_CA`, `VITE_BUY_URL`, `VITE_EXPLORER`,
`VITE_TICKER`) override the backend WebSocket, pinned CA, buy site,
explorer, and ticker.
