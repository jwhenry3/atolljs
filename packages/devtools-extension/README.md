# @atolljs/devtools-extension

A Chrome DevTools extension (Manifest V3) that adds an **atoll** panel to
DevTools for the inspected tab. The panel is the same dashboard the in-page
flyout and `/__atoll/` serve (`packages/devtools/app/`, copied in at build
time, never forked), talking to the inspected page's atoll session, so you
don't need the flyout or a second tab.

Private package: it is not published to npm.

## Build and install

```bash
npm run build:extension          # from the repo root
# or: npm run build              # inside packages/devtools-extension
```

This writes `packages/devtools-extension/dist/`. Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick `packages/devtools-extension/dist`.
3. Open DevTools on an atoll app and select the **atoll** tab.

Rebuild after changing the dashboard (`packages/devtools/app/`) or this
package, then hit the reload icon on the extension card, reopen DevTools,
and reload the app tab: Chrome doesn't inject content scripts into tabs
that were already open, so a tab loaded before the (re)install shows
`reload the page to connect`.

## Usage

The page has to publish a devtools session, exactly like the flyout needs:

```ts
import { initDevtools } from '@atolljs/devtools';
initDevtools({ session: { name: 'my-app' } }); // before pools spawn
```

and open the app with `?__atoll_devtools` in the URL (or call
`connectDevtools()`, which ignores the gate). Without a session the panel
shows an empty state pointing at the same instructions and the
[devtools docs](https://jwhenry3.github.io/atolljs/consumer/devtools/); it
picks the session up as soon as the page announces one, no DevTools reload
needed.

The header status reads:

| Status | Meaning |
|---|---|
| `connecting…` | reaching the service worker, or the page is navigating |
| `no atoll session` | attached to the page, no `hello`/`batch` seen yet |
| `inspected page` | a session is live |
| `reload the page to connect` | no content script in the tab: the page was open before the extension was installed or reloaded, or it's a page no extension can script (`chrome://`, the Chrome Web Store) |
| `page not inspectable` | attaching failed for another reason (tab gone, extension context lost) |

A late-opened panel still gets history: on attach it sends the broadcast
transport's `view` ping, and the app re-sends `hello` plus its replay tail
(the last 500 batches by default, `replayBatches`).

## Architecture

```
inspected page                          service worker            DevTools window
┌──────────────────────────────┐        ┌─────────────────┐       ┌───────────────────────────┐
│ main world                   │        │ background.js   │       │ devtools.js:              │
│  app: connectBroadcast()     │        │  ext/hub.js     │       │  panels.create('atoll',   │
│  BroadcastChannel            │        │  createHub()    │       │   …, 'app/panel.html')    │
│  'atoll-devtools'            │        │                 │       │                           │
│      ▲ hello/batch/bye/      │        │ tabId → panel   │       │ app/panel.html            │
│      │ control-result        │        │ ports + page    │       │  ext/bridge.js:           │
│      ▼ view/control          │        │ port            │ port  │  createPushBridge()       │
│ isolated world (content.js)  │  port  │                 │'atoll-│  → window.__ATOLL_BRIDGE  │
│  passive: onMessage only     │'atoll- │ validates every │panel' │  app/main.js treats it as │
│  on attach: same-origin      │◄page'─►│ frame, relays   │◄─────►│  its BroadcastChannel     │
│  BroadcastChannel + port     │        │ both ways       │       │                           │
└──────────────────────────────┘        └─────────────────┘       └───────────────────────────┘
          ▲  tabs.sendMessage({type: 'atoll-attach'}, {frameId: 0})  │
          └──────────────────────────────────────────────────────────┘
```

- **Content script, passive by default.** `content.js` is declared for
  `<all_urls>`, top frame only (`all_frames: false`), `document_start`, in
  the isolated world. Loading a page only registers a
  `chrome.runtime.onMessage` listener: no port, no BroadcastChannel, and
  the service worker isn't woken. It never touches the DOM or the page's
  JavaScript.
- **Attach.** The panel connects an `atoll-panel` port to the service
  worker and sends `{ type: 'init', tabId }`
  (`chrome.devtools.inspectedWindow.tabId`). The hub (`src/hub.js`, pure
  logic with injected `runtime`/`tabs`) sends
  `tabs.sendMessage(tabId, { type: 'atoll-attach' }, { frameId: 0 })`; the
  content script then opens `chrome.runtime.connect({ name: 'atoll-page' })`
  and `new BroadcastChannel('atoll-devtools')`. A channel opened in the
  isolated world joins the page's channel (same document, same origin);
  this was verified in Chromium 153, both directions. Attaching twice is a
  no-op.
- **Push relay.** Each app frame (`hello`, `batch`, `bye`,
  `control-result`) goes to the page port as it arrives on the channel;
  the hub relays it to the panel port, and the bridge hands it to
  `main.js`. Viewer frames (`view`, `control`) take the reverse path and
  are posted on the channel. Each hop shape-checks frames
  (`src/frames.js`), the hub being the trust boundary between page data
  and the extension. Chrome serializes port messages as JSON, so a frame
  that isn't JSON-serializable is dropped at the content script.
- **Pairing.** The hub keys everything by tab id: page ports are accepted
  only from `sender.frameId === 0` of a tab that has a panel; anything else
  is disconnected. Several panels on one tab share the page port.
- **Navigation and reload.** The old document's port drops; the hub tells
  the panel (`page-gone`, header `connecting…`) and retries the attach
  (200ms, 500ms, 1s, 2s, then every 3s) until the new document's content
  script connects. A new page port after an earlier one sends `reset`,
  which `main.js` wires to `reset()` plus `reannounce()` (clear, then
  `view`). `chrome.devtools.network.onNavigated` nudges an immediate
  attach. Same-document (SPA) navigations keep the port and the history.
  A page entering the back/forward cache loses its port (Chrome 123+
  closes extension ports then); restoring it re-attaches the same way.
- **Detach.** Closing DevTools or the panel disconnects the panel port;
  when a tab's last panel leaves, the hub disconnects the page port, and
  the content script closes its channel and is passive again.
- **Service worker lifetime.** Since Chrome 114 port messages keep an MV3
  service worker alive, but an open port alone doesn't, so the panel
  sends a `ping` every 15 seconds. If the worker restarts anyway, the
  panel reconnects (250ms, 1s, then every 2s), re-sends `init`, and treats
  the next attach as a reset, since frames may have been missed.
- **The dashboard seam** is one global pair, set by `ext/bridge.js`
  (loaded as a module before `./main.js`, so it runs first):
  `window.__ATOLL_TRANSPORT = 'extension'` and `window.__ATOLL_BRIDGE`, an
  object shaped like the BroadcastChannel main.js already uses in broadcast
  mode (`postMessage`, `onmessage({ data })`) plus `onreset`, `onstatus`,
  `status`, `label`, `nudge()` and `close()`. main.js runs its broadcast
  code path unchanged against it (local session registry, pins, TTL,
  control correlation by request id, `api.livePaused`), and reports
  `api.transport === 'extension'`. The bridge connects only once main.js
  assigns `onmessage`, so no frame lands before the dashboard listens;
  viewer frames posted before a page attaches wait in a small outbox (200
  frames).
- **Test hook.** Outside DevTools (no `chrome.devtools`), `panel.html`
  accepts `?tabId=N` to name the tab to inspect, so an automated browser
  test can open the panel as a plain tab. Inside DevTools the inspected
  tab always wins.
- **Theme.** `chrome.devtools.panels.themeName` (and
  `setThemeChangeHandler`) toggles `html.ext-light`: the dashboard is
  dark-only, so the light DevTools theme is an invert + hue-rotate filter on
  the root (`ext/ext.css`), with raster icons flipped back.
- **Panel context.** `body.ext` tells the shell (`app/panels/shell.js`) it
  is in DevTools: it keeps real history (pushState) instead of the flyout's
  replaceState-only mode, skips the flyout's parent `postMessage` calls,
  remembers its last view separately (`last:ext`), hides "Copy link to this
  view", and accepts **Ctrl/Cmd+Shift+K** for the palette (shown in the
  tooltip, help and first-run tip) besides Ctrl/Cmd+K.

## Permissions

The manifest declares **no `permissions` and no `host_permissions`**: only
`devtools_page`, a module `background.service_worker`, and one
`content_scripts` entry.

- **Install warning.** A content script matching `<all_urls>` makes Chrome
  show **"Read and change all your data on all websites"** at install.
  That is the honest reach of a script that loads on every page, even
  though this one stays passive until a panel attaches and reads nothing
  from the page except the `atoll-devtools` BroadcastChannel frames
  (`hello`, `batch`, `bye`, `control-result`), and writes only `view` and
  `control` frames to that channel.
- **Why all URLs.** The extension can't know in advance which origins run
  atoll apps (localhost ports, staging hosts, production debugging).
  Injecting on demand with `scripting.executeScript` instead needs host
  access to the page (the same warning, for all sites) or `activeTab`,
  which Chrome grants only for gestures like clicking the extension's
  toolbar action, a context menu item, or a command shortcut; opening a
  DevTools panel isn't one of them.
- `chrome.devtools.*` needs only `devtools_page`. `tabs.sendMessage` and
  `runtime.connect` need no permission; without the `tabs` permission the
  service worker can't read tab URLs, which is why `chrome://` pages share
  the `reload the page to connect` status.
- No `inspectedWindow.eval`, no remote code: every script ships in the
  extension.

## Files

| Path | What |
|---|---|
| `src/manifest.json` | MV3 manifest template (the build stamps `version` from `@atolljs/devtools`) |
| `src/devtools.html`, `src/devtools.js` | `devtools_page`: registers the panel |
| `src/background.js` | service worker: wires `chrome.runtime`/`chrome.tabs` into the hub |
| `src/hub.js` | routing: tab pairing, frame validation, attach retries, status reports (unit tested) |
| `src/content.js` | content-script relay, passive until attach (unit tested) |
| `src/frames.js` | channel/port names, message types, `isAppFrame`/`isViewerFrame` |
| `src/push-bridge.js` | `createPushBridge`: the panel's BroadcastChannel-shaped bridge (unit tested) |
| `src/bridge.js` | panel bootstrap: `body.ext`, theme, tab id, `__ATOLL_BRIDGE`, `#conn` status |
| `src/ext.css` | light-theme filter, empty-state link color |
| `scripts/build.mjs` | assembles `dist/` (copies the app, writes `app/panel.html`, `content.js`, manifest, icons) |
| `scripts/icons.mjs` | rasterizes `docs-consumer/public/atoll-icon-dark.svg` to PNG, dependency-free |

`dist/` layout: `manifest.json`, `devtools.html`, `devtools.js`,
`background.js`, `content.js`, `app/` (verbatim dashboard + `panel.html`),
`ext/` (`bridge.js`, `push-bridge.js`, `hub.js`, `frames.js`, `ext.css`),
`icons/icon-{16,32,48,128}.png`.

Manifest content scripts can't be ES modules, so the build generates
`content.js` from `src/frames.js` + `src/content.js` with the imports and
`export` keywords stripped (anything else fails the build). It also fails
if `app/index.html` gains an inline `<script>` (extension pages run under
`script-src 'self'`, so it would be dead) or loses the
`<script type="module" src="./main.js">` anchor the bridge is inserted
before.

## Tests

`npm test` covers this package (`test/`), over in-memory fakes of Chrome
ports, `runtime.onConnect` and `tabs.sendMessage` (`test/fakeChrome.ts`):

- `hub.test.ts`: pairing by tab id, the top-frame filter, malformed page
  data, `page-gone` with quiet retries then `reset`, `no-content-script`
  and `unreachable` reports, several panels per tab, page disconnect when
  the last panel leaves, nudge, moving a panel to another tab.
- `content.test.ts`: frame shape checks; passive until attach, validated
  forwarding both ways, unserializable frames dropped, idempotent attach,
  channel closed on disconnect, failure when the extension context is gone.
- `push-bridge.test.ts`: listener gating, status transitions, outbox until
  attach (and its cap), reset handling, status reports, keepalive pings,
  nudge, reconnect with re-init and reset, `close()`.
- `e2e.test.ts`: the real `connectDevtools({ transport: 'broadcast' })`
  through content relay, hub and bridge: late panel gets hello + replayed
  history, live push, a control command round-trips, a reload resets onto
  the new session, and closing the panel leaves the content script passive.
- `panel.test.ts`: `app/main.js` on the real `index.html` markup with the
  extension globals: announce, ingest, control correlation, reset +
  re-announce, the extension empty state.
- `build.test.ts`: the manifest (MV3, content script + module service
  worker, no permission keys), the generated classic `content.js`,
  panel.html injection order, copied app, PNG icons.

## Limitations

- **Install warning** for all sites, as above.
- **Pages open before install**, after an extension reload, and pages no
  extension can script (`chrome://`, the Chrome Web Store) show `reload the
  page to connect`; for the first group a reload fixes it. `file://` pages
  also need "Allow access to file URLs" on the extension's details page.
- **Top frame only.** The content script runs in the inspected page's main
  frame. Apps inside same-origin iframes still show up (one origin, one
  channel); apps in cross-origin iframes don't.
- **Origin-wide, like the flyout.** BroadcastChannel is per origin, so the
  panel sees every atoll session on the inspected page's origin, including
  other tabs of the same app. That's the broadcast transport's documented
  scoping (`docs/devtools.md`), not filtered here.
- **Shared channel side effects.** The panel's `view` ping makes the app
  replay its tail to every listener on the channel, so an open flyout or
  `/__atoll/` tab also receives the replay (as with any second dashboard).
- **History on navigation** is cleared (DevTools-style), including the old
  page's ended sessions; so is history after a service worker restart.
- **JSON only.** Chrome's port messaging is JSON, so values JSON can't
  carry (for example `BigInt`) drop the frame; `undefined` fields vanish.
- **Light theme** is a filter approximation of the dark dashboard, not a
  designed palette.
- **Aggregate server sessions** (WebSocket transport, Node apps) are not
  shown: the panel is the in-page broadcast view. Use `atoll devtools` for
  those.
- Chrome only (`minimum_chrome_version` 114, for port messages keeping the
  service worker alive).
