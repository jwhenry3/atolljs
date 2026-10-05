import { createApp } from 'vue';
import { initDevtools } from '@atolljs/devtools';
import App from './App.vue';
import './styles.css';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// No-op unless the URL carries ?__atoll_devtools.
initDevtools({
  session: { name: 'incidents-vue', framework: 'vue' },
  // Relative dashboard path — mounted hosts (the docs demo tree) ship
  // __atoll/ inside the app's own folder; absolute /__atoll/ would escape
  // a sub-path mount like consumer/<demo>/.
  overlay: { src: '__atoll/?mini=1' },
});

createApp(App).mount('#app');
