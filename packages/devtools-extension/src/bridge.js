// DevTools panel bootstrap. Loaded by app/panel.html (a build-time copy of
// the dashboard's index.html) as a module BEFORE ./main.js, so the globals
// below exist when main.js picks its transport.
import { createPushBridge } from './push-bridge.js';

const devtools = globalThis.chrome?.devtools;

document.body.classList.add('ext');

// DevTools theme: 'default' is light, 'dark' is dark. The dashboard is
// dark-only, so light mode is an invert filter (ext.css).
const applyTheme = (name) => document.documentElement.classList.toggle('ext-light', name !== 'dark');
applyTheme(devtools?.panels?.themeName ?? 'dark');
devtools?.panels?.setThemeChangeHandler?.(applyTheme);

// Test hook: outside DevTools (panel.html opened as a plain tab by an
// automated browser test) `?tabId=N` names the tab to inspect. Inside
// DevTools the inspected tab always wins.
const testTabId = () => {
  const raw = new URLSearchParams(location.search).get('tabId');
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
};

const bridge = createPushBridge({
  connect: (info) => chrome.runtime.connect(info),
  tabId: devtools ? devtools.inspectedWindow?.tabId : testTabId(),
});

const conn = document.getElementById('conn');
const showStatus = () => {
  if (!conn) return;
  conn.textContent = bridge.label;
  conn.className = bridge.status === 'live' ? 'on' : 'off';
};
bridge.onstatus = showStatus;
showStatus();

devtools?.network?.onNavigated?.addListener(() => bridge.nudge());

window.__ATOLL_TRANSPORT = 'extension';
window.__ATOLL_BRIDGE = bridge;
