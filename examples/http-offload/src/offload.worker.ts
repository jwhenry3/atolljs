// Worker entry — the shim MUST come first: it binds `self = parentPort`
// before Atoll's worker bootstrap evaluates. The incidents worker import
// registers the task handlers (EXECUTE_TASK) and binds shared memory;
// serveHttp then attaches a second listener for transferred sockets.
import '@atolljs/node/shim';
import '@atolljs/incidents/worker/incidents.worker';
import { serveHttp } from '@atolljs/node/http';
import { createApp } from './app';

// This worker owns a full http.Server, reachable two ways:
//   listen: 0  — an internal 127.0.0.1 port announced to the parent, so the
//                gateway on the main thread can proxy matching route prefixes
//                here (path-level ownership — works on any Node version);
//   HTTP_CONNECTION messages — raw sockets transferred by
//                routeHttpConnections on Node ≥ 26.
serveHttp(createApp(), { listen: 0 });
