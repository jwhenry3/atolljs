// Service worker (module). Routing lives in ext/hub.js; listeners must be
// registered synchronously at startup so a wake-up event isn't missed.
import { createHub } from './ext/hub.js';

createHub({ runtime: chrome.runtime, tabs: chrome.tabs });
