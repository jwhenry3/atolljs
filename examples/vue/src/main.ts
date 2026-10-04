import { createApp } from 'vue';
import { initDevtools } from '@atolljs/devtools';
import App from './App.vue';
import './styles.css';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// No-op unless the URL carries ?__atoll_devtools.
initDevtools({ session: { name: 'incidents-vue' } });

createApp(App).mount('#app');
