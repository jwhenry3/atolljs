import { render } from 'solid-js/web';
import { initDevtools } from '@atolljs/devtools';
import { App } from './App';
import './styles.css';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// No-op unless the URL carries ?__atoll_devtools.
initDevtools({ session: { name: 'incidents-solid' } });

render(() => <App />, document.getElementById('root')!);
