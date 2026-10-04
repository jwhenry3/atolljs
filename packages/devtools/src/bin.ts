#!/usr/bin/env node
/** `atoll-devtools [--port N]` — boot the local devtools server + dashboard. */
import { createDevtoolsServer } from './server';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: atoll-devtools [--port N]  — serve the devtools dashboard + event ingest (default port 4780)');
  process.exit(0);
}

const port = Number(arg('port') ?? 4780);
const server = await createDevtoolsServer({
  port: Number.isFinite(port) ? port : 4780,
});

console.log(`atoll devtools → ${server.url}`);
console.log('  dashboard: ' + server.url);
console.log('  ingest:    ' + server.url.replace('http://', 'ws://') + '/events');
console.log('\nIn the app:  import { connectDevtools } from \'@atolljs/devtools\'; connectDevtools()');
