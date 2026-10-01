import { mount } from 'svelte';
import App from './App.svelte';

const rootEl = document.getElementById('root');
if (rootEl) mount(App, { target: rootEl });
