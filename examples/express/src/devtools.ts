import { initDevtools } from '@atolljs/devtools/node';

/**
 * Devtools sink — imported first from main.ts so it's installed before the
 * incidents module spawns the pool (worker INIT carries the flag at spawn
 * time; late installs leave existing workers silent).
 *
 * No-op unless the process was started with ATOLL_DEVTOOLS=1 — then events
 * stream over WebSocket to the standalone dashboard (`npx atoll-devtools`,
 * http://127.0.0.1:4780). Node has no BroadcastChannel page context, so the
 * aggregate server is the transport.
 */
initDevtools({ session: { name: 'incidents-express' } });
