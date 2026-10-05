/**
 * Entry for svelte-shell.html — mounts the Svelte shell component.
 * All the interesting wiring lives in ./svelte/Shell.svelte.
 */
import { mount } from 'svelte';
import { initDevtools } from '@atolljs/devtools';
import Shell from './svelte/Shell.svelte';

// Sink before the shell mounts any island — workers only forward events
// when the flag reaches them at INIT. No-op without ?__atoll_devtools.
initDevtools({
  session: { name: 'islands-svelte-shell', framework: 'svelte' },
  overlay: { src: '__atoll/?mini=1' },
});

const rootEl = document.getElementById('root');
if (rootEl) mount(Shell, { target: rootEl });
