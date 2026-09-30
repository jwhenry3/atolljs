/**
 * Entry for svelte-shell.html — mounts the Svelte shell component.
 * All the interesting wiring lives in ./svelte/Shell.svelte.
 */
import { mount } from 'svelte';
import Shell from './svelte/Shell.svelte';

const rootEl = document.getElementById('root');
if (rootEl) mount(Shell, { target: rootEl });
