#!/usr/bin/env node
/** `atoll-devtools [--port N] [--otlp URL]` — boot the local devtools server + dashboard. */
import { createDevtoolsServer } from './server';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** `k=v,k2=v2` (the OTEL_EXPORTER_OTLP_HEADERS format) → a header record. */
const parseHeaders = (list = ''): Record<string, string> =>
  Object.fromEntries(
    list
      .split(',')
      .filter((h) => h.includes('='))
      .map((h) => [h.slice(0, h.indexOf('=')).trim(), h.slice(h.indexOf('=') + 1).trim()])
      .filter(([k]) => k !== ''),
  );

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'usage: atoll-devtools [--port N] [--otlp URL [--otlp-headers k=v,k2=v2] [--otlp-service NAME]]\n' +
      '  serve the devtools dashboard + event ingest (default port 4780);\n' +
      '  --otlp also forwards every session to an OTLP/HTTP endpoint (e.g. http://localhost:4318)',
  );
  process.exit(0);
}

const port = Number(arg('port') ?? 4780);
const otlpEndpoint = arg('otlp');
const headers = parseHeaders(arg('otlp-headers'));
const server = await createDevtoolsServer({
  port: Number.isFinite(port) ? port : 4780,
  otlp: otlpEndpoint
    ? {
        endpoint: otlpEndpoint,
        headers,
        serviceName: arg('otlp-service'),
        onError: (err) => console.warn(`otlp: ${err.message}`),
      }
    : undefined,
});

console.log(`atoll devtools → ${server.url}`);
console.log('  dashboard: ' + server.url);
console.log('  ingest:    ' + server.url.replace('http://', 'ws://') + '/events');
if (otlpEndpoint) console.log('  otlp:      ' + otlpEndpoint);
console.log('\nIn the app:  import { connectDevtools } from \'@atolljs/devtools\'; connectDevtools()');
