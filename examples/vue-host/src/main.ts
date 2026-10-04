import { createApp } from 'vue';
import { initDevtools } from '@atolljs/devtools';
import App from './App.vue';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({ session: { name: 'islands-vue-host' } });

createApp(App).mount('#root');
