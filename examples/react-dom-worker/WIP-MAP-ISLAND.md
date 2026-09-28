# WIP — real Leaflet map island (branch `map-island`)

**State at branch point:** functional map mounts and works except wheel
zoom. This file is the resumption guide — delete it when the work merges.

## Goal

Prove a real, unmodified DOM-dependent library runs inside a worker island:
Leaflet 1.9 (from npm) mounting on the worker-side proxy DOM — tiles,
markers, pan/zoom — all DOM produced by ops, zero Leaflet code on the main
thread.

## Status — what works

- `examples/react-dom-worker/src/worker/map.ts` — imperative realm app:
  `installDomShim(doc)` → `await import('leaflet')` (dynamic import is
  **required**: Leaflet reads `document`/`window` at module scope for
  Browser detection — a static import would crash before the shim lands).
  `doc.body` is the map container (it reports the pushed container size).
  divIcon markers emit `markerClicked`; a `L.Control.extend` place-picker
  emits `placeSelected`; `zoomend` emits `zoomChanged`;
  `doc.onResize(() => map.invalidateSize())` hooks the setSize channel.
- Registry entry `map: { imperative: buildMap }` in `render.worker.ts`.
- Probe results (in-process, happy-dom — `test/map-probe.test.ts`):
  - map mounts: `leaflet-container` class lands on the island `el`;
    8 OSM tile `<img>`s, 3 pins, 2 zoom controls, 3 place buttons,
    attribution — all real DOM via ops.
  - **Drag-pan works**: mousedown on `.leaflet-map-pane` → mousemove
    repositions the pane (`_leaflet_pos` expandos on unfrozen proxy
    elements + style ops) → mouseup settles.

## The blocker — wheel zoom

`fire(pane, WheelEvent { deltaY: -240 })` → Leaflet throws:

```
Error: Invalid LatLng object: (NaN, NaN)
  LatLng → unproject → pointToLatLng → layerPointToLatLng
  → containerPointToLatLng → setZoomAround → _performZoom (timer)
```

A coordinate input goes NaN inside Leaflet's zoom math. Debugging trail:

1. Instrument inside the realm (map.ts or the probe): wrap
   `map.containerPointToLatLng`, `L.DomEvent.getMousePosition`, and
   `map._getMapPanePos`/`L.DomUtil.getPosition` with console logging, then
   run the wheel dispatch in the probe — find which input is NaN.
   Candidates:
   - `getMousePosition(e, container)` → reads `e.pageX ?? e.clientX`
     minus `container.getBoundingClientRect()` + `scrollLeft`/`clientLeft`.
     Payload `clientX/Y` is defined (0 default) — verify pageX handling.
   - `getPosition(mapPane)` → `mapPane._leaflet_pos` expando (set during
     drags by setPosition) or `getBoundingClientRect` on the pane — the
     pane is NOT marked via `doc.markContainer`, so its rect is the honest
     0 → if `getPosition` subtracts rects a 0-rect could feed NaN math
     downstream. Check whether `markContainer`-style geometry needs to
     extend to the map pane specifically (or whether `_leaflet_pos`
     already covers it).
   - `_getZoomCenter`/`getWheelDelta` — `deltaMode` is normalized to 0 in
     the driver payload; verify Leaflet's `getWheelDelta` accepts it.
   - `unproject` → CRS `EPSG3857.unproject` → `Transformation.untransform`
     — if the point object itself is NaN the fault is upstream of here.
2. Note the probe fires `new WheelEvent` **without clientX/Y** (0,0) —
   valid values but the map corner; if the bug is position-dependent,
   retry with explicit center coords (320, 210) to separate "NaN bug"
   from "edge-of-map behavior".
3. `map.invalidateSize()` is wired to `doc.onResize` — the pushed-size
   channel may need the pane marked too if Leaflet re-reads pane geometry.

## What landed in the package (all green — `packages/worker-dom/test/proxyDom.test.ts`, 4 new describe blocks)

- **`setSize(realm, w, h)` wire method** — driver `ResizeObserver` on the
  island `el` pushes container size (once at mount, throttled ~100 ms);
  realm store in hostConfig (`realmSizes`, `setRealmSize`/`getRealmSize`,
  module-level so imperative rebuilds keep it). Proxy geometry reads on
  `doc.body`/`documentElement`/`doc.markContainer(el)` elements return the
  pushed box; everything else keeps the honest 0 + warn. Handler ops from
  `doc.onResize` callbacks ride the setSize return batch.
- **EventPayload enrichment** — `screenX/Y`, `which` (button+1 fallback —
  Leaflet's Draggable gates on `e.which === 1`), shift/ctrl/alt/meta,
  `deltaX/Y`, `deltaMode` (normalized to 0 = pixels when env leaves it
  undefined — Leaflet's getWheelDelta checks `deltaMode === 0`),
  `pointerType`; synthesized no-op `preventDefault`/`stopPropagation`/
  `stopImmediatePropagation` worker-side (can't cancel across
  postMessage — documented in ops.ts).
- **Reflected property accessors** — `img.src`, `a.href`, `tabIndex`,
  `width`/`height`, `alt`, `title`, `draggable` emit `attr` ops instead of
  becoming silent expandos (Leaflet assigns `tile.src`, `link.href`…).
- **`ProxyFragment`** — DocumentFragment as a phantom parent (negative id,
  never driver-side); appending splices children out like real DOM —
  Leaflet's GridLayer builds each zoom level inside one.
- **Shim upgrades** — `globalThis.Element = ProxyElement` (library
  `instanceof` checks), `document.defaultView` → window facade,
  `window.innerWidth/innerHeight` reflect the pushed size.
- **`focus()`/`blur()` noops** — Leaflet's Keyboard handler calls
  `el.focus()` in mousedown paths.
- Dispatch failures now `console.error` instead of an unhandled rejection.

## Cleanup debt before merge

- `packages/worker-dom/src/island.ts` — temporary `console.error` debug
  lines: append-miss log, root-append log, `[dbg] listen`, `applying N ops`
  per batch. Remove or gate behind a debug flag.
- `test/map-probe.test.ts` — a scratch debug harness (console.log dumps of
  op streams). Keep-or-promote: either convert to a real spec (mount →
  tiles/pins/controls assert, pan, marker click, place select — skip wheel
  if still blocked) or fold the useful parts into `islands.test.ts`.
- **Not yet wired into the page**: no `index.html` island panel and no
  `mountIsland` call in `main.ts` for `app: 'map'` — registry exists but
  the demo page doesn't mount it. Add a 6th island section + badge +
  `onEvent` → status line (markerClicked/placeSelected/zoomChanged) +
  Leaflet CSS: `import 'leaflet/dist/leaflet.css'` in main.ts (shell-side
  styles apply to op-applied DOM).
- Package README: setSize channel + new payload fields + the map demo;
  example README: map island row.
- `examples/react-dom-worker/package.json` — leaflet + @types/leaflet are
  already in dependencies; keep only if the island ships.

## Verify commands

```sh
npx vitest run examples/react-dom-worker/test/map-probe.test.ts   # the probe (1/2 passing — wheel zoom fails)
npx vitest run packages/worker-dom                                # package unit tests (all green)
npx tsc -p packages/worker-dom/tsconfig.json --noEmit
npm run build --prefix examples/react-dom-worker
npx vitest run                                                    # root suite — must stay green (was 362)
```

## If Leaflet keeps fighting back

The fallback remains the hand-rolled slippy-map on the proxy DOM (~150
lines: OSM tile URLs, lat/lng↔tile math, absolutely-positioned img grid,
drag-pan + wheel zoom + marker emits) — everything the map needs except
the library brand. Don't sink more time into Leaflet internals than the
story is worth: arbitrary-element geometry reads are the declared limit,
and hit-testing maps are exactly the library kind that reads them.
