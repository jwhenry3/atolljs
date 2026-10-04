import { mount } from 'svelte';
import { initDevtools } from '@atolljs/devtools';
import App from './App.svelte';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({ session: { name: 'islands-svelte-host' } });

const rootEl = document.getElementById('root');
if (rootEl) mount(App, { target: rootEl });
