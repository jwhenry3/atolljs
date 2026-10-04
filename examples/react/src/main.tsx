import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connectDevtools } from '@atolljs/devtools';
import { App } from './App';
import './styles.css';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
if (import.meta.env.DEV) {
  connectDevtools({ session: { name: 'incidents-react' } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
