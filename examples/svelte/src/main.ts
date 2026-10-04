import { mount } from 'svelte';
import { initDevtools } from '@atolljs/devtools';
import App from './App.svelte';
import './styles.css';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// No-op unless the URL carries ?__atoll_devtools.
initDevtools({ session: { name: 'incidents-svelte' } });

mount(App, { target: document.getElementById('app')! });
