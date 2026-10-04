/**
 * Entry for vue-shell.html — mounts the Vue shell SFC.
 * All the interesting wiring lives in ./vue/Shell.vue.
 */
import { createApp } from 'vue';
import { initDevtools } from '@atolljs/devtools';
import Shell from './vue/Shell.vue';

// Sink before the shell mounts any island — workers only forward events
// when the flag reaches them at INIT. No-op without ?__atoll_devtools.
initDevtools({
  session: { name: 'islands-vue-shell' },
  overlay: { src: '__atoll/?mini=1' },
});

const rootEl = document.getElementById('root');
if (rootEl) createApp(Shell).mount(rootEl);
