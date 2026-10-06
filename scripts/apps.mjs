// Single source of truth for the app spec: [name, project dir, port].
// Used by dev-all, kill-all, and the port preflight in serve-all.
export const apps = [
  ['devtools', 'packages/devtools', 4780],
  ['consumer-docs', 'docs-consumer', 4181],
  // The site-root landing page is a Vite app too — it mounts the five
  // examples/mfe worker islands directly on the homepage.
  ['landing', 'pages-landing', 4175],
  ['react', 'examples/react', 5173],
  ['vue', 'examples/vue', 5174],
  ['solid', 'examples/solid', 5175],
  ['svelte', 'examples/svelte', 5176],
  ['angular', 'examples/angular', 4201],
  ['nextjs', 'examples/nextjs', 3001],
  ['nestjs', 'examples/nestjs', 3100],
  ['express', 'examples/express', 3200],
  ['fastify', 'examples/fastify', 3201],
  ['hono', 'examples/hono', 3202],
  ['koa', 'examples/koa', 3203],
  ['http-offload', 'examples/http-offload', 3204],
  ['react-dom-worker', 'examples/react-dom-worker', 5177],
  ['react-host', 'examples/react-host', 5180],
  ['vue-host', 'examples/vue-host', 5181],
  ['solid-host', 'examples/solid-host', 5182],
  ['svelte-host', 'examples/svelte-host', 5183],
  ['angular-host', 'examples/angular-host', 5184],
  // Published-MFE pair — producer harness (:5185) + consumer shell (:5187).
  // :5186 is the producer's `preview:mfe` (dist-mfe/ + CORS, the fake CDN).
  ['mfe-publish', 'examples/mfe-publish', 5185],
  ['mfe-consumer', 'examples/mfe-consumer', 5187],
];
