#!/usr/bin/env node
/** `atoll-devtools [--port N]` — boot the local devtools server + dashboard. */
import { createDevtoolsServer } from './server';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const port = Number(arg('port') ?? 4780);
const server = await createDevtoolsServer({
  port: Number.isFinite(port) ? port : 4780,
});

console.log(`atoll devtools → ${server.url}`);
console.log('  dashboard: ' + server.url);
console.log('  ingest:    ' + server.url.replace('http://', 'ws://') + '/events');
console.log('\nIn the app:  import { connectDevtools } from \'@atolljs/devtools\'; connectDevtools()');
