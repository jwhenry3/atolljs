import { createRoot } from 'react-dom/client';
import { initDevtools } from '@atolljs/devtools';
import App from './App';

// Instrument before islands mount — the sink must exist when workers
// spawn for their events to forward. No-op unless the URL carries
// ?__atoll_devtools.
initDevtools({ session: { name: 'mfe-publish' } });

createRoot(document.getElementById('root')!).render(<App />);
