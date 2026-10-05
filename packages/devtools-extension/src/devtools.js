// devtools_page: runs once per DevTools window; only registers the panel.
// The panel page connects to the inspected tab itself (ext/bridge.js).
chrome.devtools.panels.create('atoll', 'icons/icon-32.png', 'app/panel.html', () => {});
