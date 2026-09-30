/**
 * Entry for vue-shell.html — mounts the Vue shell SFC.
 * All the interesting wiring lives in ./vue/Shell.vue.
 */
import { createApp } from 'vue';
import Shell from './vue/Shell.vue';

const rootEl = document.getElementById('root');
if (rootEl) createApp(Shell).mount(rootEl);
