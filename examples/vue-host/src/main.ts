import { createApp } from 'vue';
import { initDevtools } from '@atolljs/devtools';
import App from './App.vue';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({
  session: { name: 'islands-vue-host', framework: 'vue' },
  // Relative dashboard path — mounted hosts (the docs demo tree) ship
  // __atoll/ inside the app's own folder; absolute /__atoll/ would escape
  // a sub-path mount like consumer/<demo>/.
  overlay: { src: '__atoll/?mini=1' },
});

createApp(App).mount('#root');
