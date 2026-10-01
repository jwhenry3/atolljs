/**
 * Per-route SEO metadata for the prerendered docs site.
 *
 * `prerender.mjs` writes one HTML file per route and stamps these values into
 * <title> / <meta name="description"> / canonical / Open Graph. Anything not
 * listed falls back to `metaFor`'s generic description.
 */

import { postBySlug } from './blog';

const FRAMEWORK_LABELS: Record<string, string> = {
  'fw-react': 'React',
  'fw-vue': 'Vue',
  'fw-solid': 'Solid',
  'fw-svelte': 'Svelte',
  'fw-angular': 'Angular',
  'fw-nextjs': 'Next.js',
};

const FRAMEWORK_SUB_LABELS: Record<string, string> = {
  quickstart: 'quickstart',
  examples: 'examples',
  advanced: 'advanced usage',
  'worker-islands': 'worker-rendered islands',
};

/** Hand-written descriptions — the routes crawlers are most likely to land on. */
const ROUTE_DESC: Record<string, string> = {
  quickstart:
    'Install @atolljs/core and run your first typed worker pool — schema-defined shared memory, main-thread reactivity, and cancellation in ten minutes.',
  overview:
    'Atoll is a TypeScript toolkit for real multithreading in JavaScript: typed worker pools, SharedArrayBuffer contracts, Atomics-based reactivity, and worker-rendered UI islands.',
  cli:
    'The atoll CLI — scaffold worker pools, shared-memory contracts, and islands with atoll new/init/add, and audit the setup with atoll doctor.',
  'shared-memory':
    'defineSharedMemory — deterministic schema layouts over SharedArrayBuffer, versioned fields, and transactional writes shared by every thread.',
  reef:
    'reef — the fixed-width schema vocabulary for atoll shared memory: every schema is both the validator and the binary layout spec.',
  tasks:
    'Typed worker pools with cancellation, timeouts, backpressure, progress, and crash respawn — postMessage for calls, shared memory for state.',
  reactivity:
    'Atomics-driven change notification — subscribe to shared-memory fields on the main thread without polling or message fan-out.',
  'shared-worker':
    'Share one worker pool across tabs with SharedWorker — the atoll client runs in the shared worker so shared memory stays per-browser.',
  'bundle-size':
    'Per-package bundle sizes, dependency budgets, and processing-load numbers for every @atolljs package on npm.',
  islands:
    'Worker-rendered UI islands — real React, Vue, Solid, Svelte, or Angular components running inside workers, streamed to the DOM over an op protocol.',
  'island-apps':
    'Write island apps: definePolyWorker entries, serializable props, emit() events to the shell, and mountIsland on the main thread.',
  'island-mfe':
    'Micro-frontends with island contracts — one framework-free contract module per MFE, any supported framework in the worker, any supported framework in the shell.',
  'island-proxy':
    'The Islands → Proxy document engine: op protocol, latency split between app and engine, live-node counts, and memory inflation.',
  'fw-node':
    '@atolljs/node — run atoll worker pools on node:worker_threads and attach them to Express, Fastify, Hono, Koa, or raw http.',
  'fw-node/adapters':
    'Framework adapters for Node.js — plug an atoll pool into Express, Fastify, Hono, Koa, or a bare http server.',
  'fw-node/clustering':
    'Socket-transfer clustering — hand accepted connections straight to workers on Node ≥ 26 for main-thread-free request handling.',
  'fw-node/gateway':
    'Gateway routing — keep the HTTP server on the main thread and proxy matching requests into the worker pool.',
  'fw-node/websockets':
    'WebSocket upgrade tunneling — proxy upgrades through the gateway or transfer them with the raw socket on Node ≥ 26.',
  'fw-node/persistence':
    'Redis-backed shared-memory persistence — persistSharedMemory mirrors versioned fields into Redis hashes and replays ops across processes.',
  'fw-nestjs':
    '@atolljs/nestjs — host atoll pools inside NestJS: injected worker clients, clustering, WebSocket tunneling, and Redis persistence.',
  'fw-nestjs/facades':
    'Service facades — @AtollService makes a provider class the interop surface: inject normally on the API thread, every method dispatches to the pool.',
  'fw-nestjs/housed':
    'Housed APIs — registerPool exposes worker services as injected NestJS providers and serves worker-held HTTP routes.',
  'fw-nestjs/clustering':
    'NestJS socket-transfer clustering — route raw connections into workers behind the Nest HTTP server.',
  'fw-nestjs/websockets':
    'NestJS WebSocket tunneling — upgrades flow through the gateway or transfer with the socket to worker-hosted handlers.',
  'fw-nestjs/persistence':
    'NestJS Redis persistence — wire persistSharedMemory into the module config for durable shared-memory state.',
  'fw-nextjs-server':
    'Atoll in Next.js server code — shared pools across route handlers, job queues, read-model APIs, boot warmup, and custom servers.',
  'fw-nextjs-server/jobs':
    'A worker-pool job queue inside Next.js — enqueue typed work from route handlers and track progress through shared memory.',
  'fw-nextjs-server/read-model':
    'Worker-held read models behind Next.js routes — shared-memory query surfaces served without blocking the event loop.',
  'fw-nextjs-server/warmup':
    'Boot warmup — prebuild worker pools during Next.js startup so the first request never pays spawn cost.',
  'fw-nextjs-server/custom-server':
    'Custom Next.js servers — attach clustering and gateway routing to a self-hosted Node server.',
  'custom-bindings':
    'Custom bindings — wrap the typed pool client and shared-memory contract in your own framework-facing API.',
  'custom-islands':
    'Custom island renderers — implement the worker-side renderer contract and drive the proxy DOM protocol from any framework.',
  hosting:
    'Hosting requirements — COOP/COEP headers for SharedArrayBuffer, fallback poll mode, and static deploy notes.',
  blog:
    'AtollJS blog — long-form writing on what the framework is for and how its facades make worker interop feel like ordinary code.',
};

export interface RouteMeta {
  title: string;
  description: string;
}

export function metaFor(id: string, label: string): RouteMeta {
  const title = id === 'blog' ? 'Atoll blog' : `Atoll docs — ${label}`;

  const desc = ROUTE_DESC[id];
  if (desc) return { title, description: desc };

  // Blog posts: description from the post's subtitle or first paragraph.
  if (id.startsWith('blog/')) {
    const post = postBySlug(id.slice(5));
    if (post) {
      return {
        title: `Atoll blog — ${post.title}`,
        description: post.subtitle ?? post.excerpt,
      };
    }
  }

  // Framework pages: synthesize from the route shape — fw-<name>,
  // fw-<name>/<sub>. Avoids hand-writing ~24 near-identical entries.
  const [fwId, sub] = id.split('/');
  const fwName = FRAMEWORK_LABELS[fwId];
  if (fwName && !sub) {
    return {
      title,
      description: `Use @atolljs/${fwId} — ${fwName} bindings for atoll worker pools: installation, typed clients, and shared-memory setup.`,
    };
  }
  if (fwName && sub) {
    const subLabel = FRAMEWORK_SUB_LABELS[sub] ?? sub;
    return {
      title,
      description: `${fwName} ${subLabel} with atoll — worker pools, typed clients, and shared memory in a ${fwName} app.`,
    };
  }

  return {
    title,
    description: 'Atoll package documentation — typed worker pools, shared memory, and worker-rendered islands for JavaScript.',
  };
}
