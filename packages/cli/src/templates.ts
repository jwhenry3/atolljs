import { camel, pascal } from './parse.ts';
import type { Framework } from './project.ts';
import type { OutFile } from './files.ts';

/** The hardened .npmrc the CLI drops into every project it touches. */
export const NPMRC = `# Supply-chain hardening — read by every npm command run in this directory.
#
# Newly published versions must age 7 days before they can enter the
# lockfile (requires npm >= 11.10 — shipped with Node 26; older npm
# silently ignores this key).
min-release-age=7
# Install lifecycle scripts are the dominant malware vector — none run
# during install/ci. If a native dep ever legitimately needs one:
#   npm rebuild <pkg> --ignore-scripts=false
ignore-scripts=true
# \`npm install <pkg>\` writes exact pins, not ^ ranges.
save-exact=true
fund=false
`;

export const GITIGNORE = `node_modules/
dist/
`;

/* ── shared-memory contract ─────────────────────────────────────────────── */

export function memoryContract(name: string): string {
  const c = camel(name);
  return `import { defineSharedMemory, field, mz } from '@atolljs/core';

/**
 * ${c} shared memory — the single source of truth for state both threads
 * touch. The spec compiles to one deterministic fixed-width layout; main
 * thread and workers bind the same declaration, so the two sides can never
 * disagree on byte offsets.
 */
export const ${c}Memory = defineSharedMemory({
  // Versioned scalars — observe()/watch() park on Atomics; zero postMessage.
  signals: {
    progress: field.number(),
  },
  // Structured snapshots — one inline record, rewritten wholesale.
  state: {
    summary: field.object({
      schema: mz.object({
        total: mz.f64(),
        errors: mz.f64(),
        updatedAt: mz.u32(),
      }),
    }),
  },
});
export type ${pascal(name)}Memory = typeof ${c}Memory;
`;
}

/* ── worker pool (defineWorker + typed client) ──────────────────────────── */

export interface WorkerOpts {
  /** 'browser' uses connectWorker + DOM Worker; 'node' uses createNodePool. */
  host: 'browser' | 'node';
  /** Import specifier for a shared-memory contract, or null. */
  memoryImport?: string | null;
  /** Memory export name (camelCase, e.g. \`appMemory\`). */
  memoryName?: string;
  /** URL for the bundled node worker, relative to the client file. */
  distUrl?: string;
  /** Emit writes to the generated contract's fields inside the echo task —
   *  only valid when memoryName refers to a CLI-generated contract. */
  demoMemoryWrite?: boolean;
}

export function workerEntry(name: string, opts: WorkerOpts): string {
  const c = camel(name);
  const memImport = opts.memoryImport
    ? `import { ${opts.memoryName} } from '${opts.memoryImport}';\n`
    : '';
  const memLine = opts.memoryName ? `  sharedMemory: ${opts.memoryName},\n` : '';
  const shim = opts.host === 'node'
    ? `// Node worker entry — the shim binds self = parentPort BEFORE\n// defineWorker's bootstrap evaluates; import order is the contract.\nimport '@atolljs/node/shim';\n`
    : '';
  return `${shim}import { defineWorker, serviceMethod } from '@atolljs/core';
import { z } from 'zod';
${memImport}
const echo = serviceMethod({
  def: { argsSchema: z.tuple([z.string()]), resultSchema: z.string() },
  run: (message) => {${
    opts.demoMemoryWrite && opts.memoryName
      ? `
    // Shared memory crosses the boundary without a message — the main
    // thread can read these the moment the task resolves.
    ${opts.memoryName}.signals.progress.write(100);
    ${opts.memoryName}.state.summary.write({
      total: 1,
      errors: 0,
      updatedAt: Math.floor(Date.now() / 1000),
    });`
      : ''
  }
    return \`worker heard: \${message}\`;
  },
});

/**
 * ${c} worker entry — defineWorker installs the message loop and registers
 * every method. The main thread imports only the TYPE (typeof ${c}Worker)
 * and drives calls through the pool client.
 */
export const ${c}Worker = defineWorker({
${memLine}  methods: { echo },
});
export type ${pascal(name)}Worker = typeof ${c}Worker;
`;
}

export function workerClientFile(name: string, opts: WorkerOpts): string {
  const c = camel(name);
  const P = pascal(name);
  const memImport = opts.memoryImport
    ? `import { ${opts.memoryName} } from '${opts.memoryImport}';\n`
    : '';
  const memLine = opts.memoryName ? `  sharedMemory: ${opts.memoryName},\n` : '';
  if (opts.host === 'node') {
    return `import { Worker } from 'node:worker_threads';
import { workerClient, defineTask } from '@atolljs/core';
import { createNodePool } from '@atolljs/node';
${memImport}import type { ${P}Worker } from './${name}.worker';

/**
 * ${c} pool — node:worker_threads workers adapted to the pool surface.
 * The worker entry must be bundled before spawning (Node workers run
 * outside tsx's loader):
 *
 *   esbuild src/atoll/${name}.worker.ts --bundle --platform=node \\
 *     --format=esm --packages=external --outfile=dist/${name}.worker.js
 */
export const ${c}Pool = createNodePool({
  worker: () => new Worker(new URL('${opts.distUrl ?? `./dist/${name}.worker.js`}', import.meta.url)),
${memLine}  poolSize: 'auto',
});

/** Typed client — calls read like the worker's own method names. */
export const ${c} = workerClient<${P}Worker>(${c}Pool);

/** Latest-wins task over a call — { data, pending, settled, elapsedMs }. */
export const ${c}EchoTask = defineTask((message: string) => ${c}.echo(message));
`;
  }
  return `import { connectWorker, defineTask } from '@atolljs/core';
${memImport}import type { ${P}Worker } from './${name}.worker';

/**
 * ${c} — typed client over the worker pool. Spawning is lazy, so importing
 * this module never touches Worker (SSR-safe); the first method call (or
 * ${c}.start()) brings the pool up. Keep the new Worker(new URL(...)) call
 * inline — bundlers detect worker entries by that exact shape.
 */
export const ${c} = connectWorker<${P}Worker>({
  worker: () =>
    new Worker(new URL('./${name}.worker.ts', import.meta.url), { type: 'module' }),
${memLine}  poolSize: 'auto',
});
export type ${P}Client = typeof ${c};

/** Latest-wins task over a call — { data, pending, settled, elapsedMs }. */
export const ${c}EchoTask = defineTask((message: string) => ${c}.echo(message));
`;
}

/* ── islands — worker entry per framework ───────────────────────────────── */

const ISLAND_EXT: Record<string, string> = {
  react: 'tsx',
  vue: 'ts',
  solid: 'tsx',
  svelte: 'ts',
  angular: 'ts',
};

/** Worker-entry files for `add island`. Emits the component + worker. */
export function islandFiles(name: string, fw: Framework, dir = 'src/islands'): OutFile[] {
  const P = pascal(name);
  switch (fw) {
    case 'react':
      return [
        {
          path: `${dir}/${name}.worker.tsx`,
          content: `import { useState } from 'react';
import { defineReactMonoWorker } from '@atolljs/react-island/worker';
import { emit } from '@atolljs/islands/worker';

/**
 * ${P} — a real React component rendered INSIDE the worker. Mutations
 * serialize to ops; the shell driver replays them into real DOM.
 * Handlers receive the plain wire payload, not a SyntheticEvent.
 */
function ${P}({ label = '${name}' }: { label?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div>
      <span>
        {label}: {count}
      </span>
      <button
        onClick={() => {
          const n = count + 1;
          setCount(n);
          emit('incremented', { count: n });
        }}
      >
        increment
      </button>
    </div>
  );
}

export const worker = defineReactMonoWorker(${P});
`,
        },
      ];
    case 'vue':
      return [
        {
          path: `${dir}/${P}.vue`,
          content: `<script setup lang="ts">
import { ref } from 'vue';
import { emit } from '@atolljs/islands/worker';

// Rendered inside the worker — DOM ops stream to the shell; emit()
// sends app events back to it.
defineProps<{ label?: string }>();
const count = ref(0);
function increment() {
  count.value += 1;
  emit('incremented', { count: count.value });
}
</script>

<template>
  <div>
    <span>{{ label ?? '${name}' }}: {{ count }}</span>
    <button @click="increment">increment</button>
  </div>
</template>
`,
        },
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { defineVueMonoWorker } from '@atolljs/vue-island/worker';
import ${P} from './${P}.vue';

export const worker = defineVueMonoWorker(${P});
`,
        },
      ];
    case 'solid':
      return [
        {
          path: `${dir}/${name}.worker.tsx`,
          content: `import { createSignal } from 'solid-js';
import { defineSolidMonoWorker } from '@atolljs/solid-island/worker';
import { emit } from '@atolljs/islands/worker';

/** ${P} — Solid rendering inside the worker; ops stream to the shell. */
function ${P}(props: { label?: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <span>
        {props.label ?? '${name}'}: {count()}
      </span>
      <button
        onClick={() => {
          const n = count() + 1;
          setCount(n);
          emit('incremented', { count: n });
        }}
      >
        increment
      </button>
    </div>
  );
}

export const worker = defineSolidMonoWorker(${P});
`,
        },
      ];
    case 'svelte':
      return [
        {
          path: `${dir}/${P}.svelte`,
          content: `<script lang="ts">
  import { emit } from '@atolljs/islands/worker';

  // Rendered inside the worker — DOM ops stream to the shell.
  let { label = '${name}' }: { label?: string } = $props();
  let count = $state(0);
  function increment() {
    count += 1;
    emit('incremented', { count });
  }
</script>

<div>
  <span>{label}: {count}</span>
  <button onclick={increment}>increment</button>
</div>
`,
        },
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { defineSvelteMonoWorker } from '@atolljs/svelte-island/worker';
import ${P} from './${P}.svelte';

export const worker = defineSvelteMonoWorker(${P});
`,
        },
      ];
    case 'angular':
      return [
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { Component } from '@angular/core';
import { defineMonoWorker } from '@atolljs/islands/worker';
import { angularIslandApp } from '@atolljs/angular-island/worker';

/**
 * ${P}Component — rendered inside the worker by Angular's own engine;
 * ops stream to the shell driver on the main thread.
 */
@Component({
  template: \`
    <div>
      <span>{{ label }}: {{ count }}</span>
      <button (click)="increment()">increment</button>
    </div>
  \`,
})
export class ${P}Component {
  label = '${name}';
  count = 0;
  increment() {
    this.count += 1;
  }
}

export const worker = defineMonoWorker(angularIslandApp(${P}Component));
`,
        },
      ];
    default:
      return [];
  }
}

/** Shell-side usage hint printed after `add island` — one per framework. */
export function islandUsage(name: string, fw: Framework): string {
  const P = pascal(name);
  const ext = ISLAND_EXT[fw] ?? 'ts';
  const factory = `() => new Worker(new URL('./islands/${name}.worker.${ext}', import.meta.url), { type: 'module' })`;
  switch (fw) {
    case 'react':
      return `// mount it in your shell — worker factory stays inline so the bundler sees it
import { Island } from '@atolljs/react-island';

<Island app="${name}" worker={${factory}} onEvent={(n, p) => console.log(n, p)} />`;
    case 'vue':
      return `<script setup>
import { AtollIsland } from '@atolljs/vue-island';
const worker = ${factory};
</script>

<template>
  <AtollIsland app="${name}" :worker="worker" />
</template>`;
    case 'solid':
      return `import { Island } from '@atolljs/solid-island';

<Island app="${name}" worker={${factory}} />`;
    case 'svelte':
      return `<script lang="ts">
  import { island } from '@atolljs/svelte-island';
  const worker = ${factory};
</script>

<div use:island={{ app: '${name}', worker }} />`;
    case 'angular':
      return `import { islandComponent } from '@atolljs/angular-island';
import type { ${P}Component } from './islands/${name}.worker';

export const ${P}Island = islandComponent<${P}Component>({
  app: '${name}',
  worker: ${factory},
});
// then use the generated component in a template — see docs/consumer Angular islands`;
    default:
      return '';
  }
}

/* ── `atoll new` — full app scaffolds ───────────────────────────────────── */

const HEADERS = `  // SharedArrayBuffer is gated behind cross-origin isolation — these
  // headers unlock it; islands/pools degrade gracefully without them.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },`;

interface ScaffoldSpec {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  vitePlugin?: { pkg: string; import_: string; call: string };
}

const SCAFFOLDS: Record<string, ScaffoldSpec> = {
  react: {
    deps: { react: '^19.3.0', 'react-dom': '^19.3.0', 'react-reconciler': '^0.34.0', '@atolljs/core': '^0.1.0', '@atolljs/react': '^0.1.0', '@atolljs/react-island': '^0.1.0', zod: '^4.6.5' },
    devDeps: { vite: '^8.3.1', typescript: '^7.0.2', '@vitejs/plugin-react': '^6.1.1', '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0' },
    vitePlugin: { pkg: '@vitejs/plugin-react', import_: `import react from '@vitejs/plugin-react';`, call: 'react()' },
  },
  vue: {
    deps: { vue: '^3.5.43', '@atolljs/core': '^0.1.0', '@atolljs/vue': '^0.1.0', '@atolljs/vue-island': '^0.1.0', zod: '^4.6.5' },
    devDeps: { vite: '^8.3.1', typescript: '^7.0.2', '@vitejs/plugin-vue': '^6.0.9' },
    vitePlugin: { pkg: '@vitejs/plugin-vue', import_: `import vue from '@vitejs/plugin-vue';`, call: 'vue()' },
  },
  solid: {
    deps: { 'solid-js': '^1.9.15', '@atolljs/core': '^0.1.0', '@atolljs/solidjs': '^0.1.0', '@atolljs/solid-island': '^0.1.0', zod: '^4.6.5' },
    devDeps: { vite: '^8.3.1', typescript: '^7.0.2', 'vite-plugin-solid': '^2.11.14' },
    vitePlugin: { pkg: 'vite-plugin-solid', import_: `import solid from 'vite-plugin-solid';`, call: 'solid()' },
  },
  svelte: {
    deps: { svelte: '^5.57.1', '@atolljs/core': '^0.1.0', '@atolljs/svelte': '^0.1.0', '@atolljs/svelte-island': '^0.1.0', zod: '^4.6.5' },
    devDeps: { vite: '^8.3.1', typescript: '^7.0.2', '@sveltejs/vite-plugin-svelte': '^7.3.1' },
    vitePlugin: { pkg: '@sveltejs/vite-plugin-svelte', import_: `import { svelte } from '@sveltejs/vite-plugin-svelte';`, call: 'svelte()' },
  },
};

export const SCAFFOLD_FRAMEWORKS = Object.keys(SCAFFOLDS) as readonly string[];

function pkgJson(appName: string, spec: ScaffoldSpec): string {
  return (
    JSON.stringify(
      {
        name: appName,
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: spec.deps,
        devDependencies: spec.devDeps,
      },
      null,
      2,
    ) + '\n'
  );
}

const TSCONFIGS: Record<string, object> = {
  react: {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'], jsx: 'react-jsx',
      strict: true, noEmit: true, isolatedModules: true, skipLibCheck: true,
      allowImportingTsExtensions: true,
    },
    include: ['src'],
  },
  vue: {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      strict: true, noEmit: true, isolatedModules: true, skipLibCheck: true,
      allowImportingTsExtensions: true,
    },
    include: ['src'],
  },
  solid: {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'], jsx: 'preserve', jsxImportSource: 'solid-js',
      strict: true, noEmit: true, isolatedModules: true, skipLibCheck: true,
      allowImportingTsExtensions: true,
    },
    include: ['src'],
  },
  svelte: {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      strict: true, noEmit: true, isolatedModules: true, skipLibCheck: true,
      allowImportingTsExtensions: true, types: ['vite/client'],
    },
    include: ['src'],
  },
  node: {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      // DOM+WebWorker libs — @atolljs/node types pool workers against the
      // DOM Worker surface; without them its shipped source won't typecheck.
      lib: ['ESNext', 'DOM', 'WebWorker'], types: ['node'],
      strict: true, noEmit: true, isolatedModules: true, skipLibCheck: true,
      allowImportingTsExtensions: true,
    },
    include: ['src'],
  },
};

function viteConfig(fw: string): string {
  const spec = SCAFFOLDS[fw];
  const plugin = spec.vitePlugin;
  return `import { defineConfig } from 'vite';
${plugin?.import_ ?? ''}

export default defineConfig({
  plugins: [${plugin?.call ?? ''}],
${
  plugin
    ? `  // Worker bundles run their own rolldown pass — fresh plugin instances
  // let the worker entry compile framework files too (worker-island apps).
  worker: { plugins: () => [${plugin.call}] },
`
    : ''
}${HEADERS}
});
`;
}

const INDEX_HTML = (title: string, entry: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entry}"></script>
  </body>
</html>
`;

/** All files for `atoll new <dir> --framework <fw>` (browser vite apps). */
export function scaffoldFiles(appName: string, fw: Framework): OutFile[] {
  const spec = SCAFFOLDS[fw];
  if (!spec) return [];
  const files: OutFile[] = [
    { path: 'package.json', content: pkgJson(appName, spec) },
    { path: 'tsconfig.json', content: JSON.stringify(TSCONFIGS[fw], null, 2) + '\n' },
    { path: 'vite.config.ts', content: viteConfig(fw) },
    { path: '.npmrc', content: NPMRC },
    { path: '.gitignore', content: GITIGNORE },
    { path: 'index.html', content: INDEX_HTML(appName, `src/main.${ISLAND_EXT[fw]}`) },
  ];
  const counter = islandFiles('counter', fw);
  switch (fw) {
    case 'react':
      files.push(
        ...counter,
        {
          path: 'src/main.tsx',
          content: `import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
`,
        },
        {
          path: 'src/App.tsx',
          content: `import { Island } from '@atolljs/react-island';

/**
 * The counter island renders inside a worker — the main thread only replays
 * its DOM ops. New islands: \`npx atoll add island <name>\`.
 */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>${appName}</h1>
      <p>This counter renders in a worker thread.</p>
      <Island
        app="counter"
        worker={() =>
          new Worker(new URL('./islands/counter.worker.tsx', import.meta.url), { type: 'module' })
        }
        onEvent={(name, payload) => console.log('island event:', name, payload)}
      />
    </main>
  );
}
`,
        },
      );
      break;
    case 'vue':
      files.push(
        ...counter,
        { path: 'src/env.d.ts', content: `declare module '*.vue';\n` },
        {
          path: 'src/main.ts',
          content: `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#root');
`,
        },
        {
          path: 'src/App.vue',
          content: `<script setup lang="ts">
import { AtollIsland } from '@atolljs/vue-island';

// The counter island renders inside a worker — the main thread replays ops.
const worker = () =>
  new Worker(new URL('./islands/counter.worker.ts', import.meta.url), { type: 'module' });
</script>

<template>
  <main style="font-family: system-ui; padding: 2rem">
    <h1>${appName}</h1>
    <p>This counter renders in a worker thread.</p>
    <AtollIsland app="counter" :worker="worker" />
  </main>
</template>
`,
        },
      );
      break;
    case 'solid':
      files.push(
        ...counter,
        {
          path: 'src/main.tsx',
          content: `import { render } from 'solid-js/web';
import { App } from './App';

render(() => <App />, document.getElementById('root')!);
`,
        },
        {
          path: 'src/App.tsx',
          content: `import { Island } from '@atolljs/solid-island';

/** The counter island renders inside a worker — the main thread replays ops. */
export function App() {
  return (
    <main style={{ 'font-family': 'system-ui', padding: '2rem' }}>
      <h1>${appName}</h1>
      <p>This counter renders in a worker thread.</p>
      <Island
        app="counter"
        worker={() =>
          new Worker(new URL('./islands/counter.worker.tsx', import.meta.url), { type: 'module' })
        }
      />
    </main>
  );
}
`,
        },
      );
      break;
    case 'svelte':
      files.push(
        ...counter,
        {
          path: 'src/main.ts',
          content: `import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('root')! });
`,
        },
        {
          path: 'src/App.svelte',
          content: `<script lang="ts">
  import { island } from '@atolljs/svelte-island';

  // The counter island renders inside a worker — the main thread replays ops.
  const worker = () =>
    new Worker(new URL('./islands/counter.worker.ts', import.meta.url), { type: 'module' });
</script>

<main style="font-family: system-ui; padding: 2rem">
  <h1>${appName}</h1>
  <p>This counter renders in a worker thread.</p>
  <div use:island={{ app: 'counter', worker }} />
</main>
`,
        },
      );
      break;
  }
  return files;
}

/** `atoll new --framework node` — a tsx service with a worker pool. */
export function nodeScaffoldFiles(appName: string): OutFile[] {
  return [
    {
      path: 'package.json',
      content:
        JSON.stringify(
          {
            name: appName,
            private: true,
            type: 'module',
            scripts: {
              dev: 'tsx watch src/main.ts',
              start: 'tsx src/main.ts',
              bundle:
                'esbuild src/atoll/tasks.worker.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/tasks.worker.js',
            },
            dependencies: { '@atolljs/core': '^0.1.0', '@atolljs/node': '^0.1.0', zod: '^4.6.5' },
            devDependencies: { esbuild: '^0.28.2', tsx: '^4.23.15', typescript: '^7.0.2', '@types/node': '^26.6.3' },
          },
          null,
          2,
        ) + '\n',
    },
    { path: 'tsconfig.json', content: JSON.stringify(TSCONFIGS.node, null, 2) + '\n' },
    { path: '.npmrc', content: NPMRC },
    { path: '.gitignore', content: GITIGNORE },
    {
      path: 'src/atoll/tasks.memory.ts',
      content: memoryContract('tasks'),
    },
    {
      path: 'src/atoll/tasks.worker.ts',
      content: workerEntry('tasks', {
        host: 'node',
        memoryImport: './tasks.memory',
        memoryName: 'tasksMemory',
        demoMemoryWrite: true,
      }),
    },
    {
      path: 'src/atoll/tasks.ts',
      content: workerClientFile('tasks', {
        host: 'node',
        memoryImport: './tasks.memory',
        memoryName: 'tasksMemory',
        distUrl: '../../dist/tasks.worker.js',
      }),
    },
    {
      path: 'src/main.ts',
      content: `import { tasks, tasksPool } from './atoll/tasks';
import { tasksMemory } from './atoll/tasks.memory';

/**
 * ${appName} — a worker pool behind a typed client. The echo task runs off
 * the main thread; shared memory is readable here with zero dispatch.
 */
const heard = await tasks.echo('hello from main');
console.log(heard);
console.log('summary (shared memory):', tasksMemory.state.summary.read());

await tasksPool.close();
`,
    },
  ];
}

/* ── framework bindings over a pool client (`add <fw> worker <name>`) ────── */

interface MemRef {
  /** Import specifier relative to the generated file. */
  import_: string;
  /** Contract export name, e.g. `appMemory`. */
  export_: string;
}

const UI_BINDINGS: readonly Framework[] = [
  'react',
  'nextjs',
  'vue',
  'solid',
  'svelte',
  'angular',
];

export const hasWorkerBindings = (fw: Framework): boolean => UI_BINDINGS.includes(fw);

/**
 * The framework-facing half of `add worker` — a hooks/signals adapter module
 * beside the pool client, so components never touch the client directly.
 * Returns null for frameworks without a binding idiom (node, vanilla…).
 */
export function workerBindingsFile(
  name: string,
  fw: Framework,
  dir: string,
  mem: MemRef | null,
): OutFile | null {
  const c = camel(name);
  const P = pascal(name);
  const memImport = mem ? `import { ${mem.export_} } from '${mem.import_}';\n` : '';
  // 'signals.progress' exists on CLI-generated contracts — emitted as a
  // commented example so a hand-authored contract never breaks the build.
  const watchLine = (hook: string, decl = 'const') =>
    mem ? `\n  // ${decl} progress = ${hook}(${mem.export_}, 'signals.progress');` : '';
  switch (fw) {
    case 'react':
      return {
        path: `${dir}/use${P}.ts`,
        content: `import { useTask${mem ? ', useSharedValue' : ''} } from '@atolljs/react';
import { ${c} } from './${name}';
${memImport}
/**
 * React bindings for the ${name} pool — call inside components. useTask
 * wraps a call in { data, pending, settled, elapsedMs, error } with
 * latest-wins run()/runOnce(); useSharedValue parks on Atomics.
 */
export function use${P}() {
  const echo = useTask(${c}.echo);${watchLine('useSharedValue')}
  return { echo };
}
`,
      };
    case 'nextjs':
      return {
        path: `${dir}/${name}.tsx`,
        content: `'use client';
import { useTask${mem ? ', useSharedValue' : ''} } from '@atolljs/nextjs';
import { ${c} } from './${name}';
${memImport}
/**
 * Client component over the ${name} pool — 'use client' keeps the hooks
 * browser-side; SSR-safe because the pool spawns lazily on first call.
 */
export function ${P}() {
  const echo = useTask(${c}.echo);${watchLine('useSharedValue')}
  return (
    <button onClick={() => echo.run('ping')}>
      {echo.data ?? (echo.pending ? 'working\\u2026' : '${name}')}
    </button>
  );
}
`,
      };
    case 'vue':
      return {
        path: `${dir}/use${P}.ts`,
        content: `import { useTask${mem ? ', useSharedValue' : ''} } from '@atolljs/vue';
import { ${c} } from './${name}';
${memImport}
/** Vue composable over the ${name} pool — refs, ready for <script setup>. */
export function use${P}() {
  const echo = useTask(${c}.echo);${watchLine('useSharedValue')}
  return { echo };
}
`,
      };
    case 'solid':
      return {
        path: `${dir}/use${P}.ts`,
        content: `import { createTask${mem ? ', createSharedValue' : ''} } from '@atolljs/solidjs';
import { ${c} } from './${name}';
${memImport}
/** Solid bindings over the ${name} pool — accessors, call inside setup. */
export function create${P}() {
  const echo = createTask(${c}.echo);${watchLine('createSharedValue')}
  return { echo };
}
`,
      };
    case 'svelte':
      // *.svelte.ts — runes ($effect inside taskState/sharedValue) only
      // compile in svelte-module files.
      return {
        path: `${dir}/${name}.svelte.ts`,
        content: `import { taskState${mem ? ', sharedValue' : ''} } from '@atolljs/svelte';
import { ${c} } from './${name}';
${memImport}
/** Svelte bindings over the ${name} pool — call inside components. */
export function ${c}State() {
  const echo = taskState(${c}.echo);${watchLine('sharedValue')}
  return { echo };
}
`,
      };
    case 'angular':
      return {
        path: `${dir}/${name}.facade.ts`,
        content: `import { Injectable } from '@angular/core';
import { taskState${mem ? ', sharedValue' : ''} } from '@atolljs/angular';
import { ${c} } from './${name}';
${memImport}
/**
 * Angular facade over the ${name} pool — field initializers run in the
 * injection context, so the signal subscription unbinds on destroy.
 */
@Injectable({ providedIn: 'root' })
export class ${P}Facade {
  readonly echo = taskState(${c}.echo);${watchLine('sharedValue', 'readonly')}
  readonly run = (message: string) => this.echo.run(message);
}
`,
      };
    default:
      return null;
  }
}

/* ── islands — facade variant: contract module + lazy import ────────────── */

/**
 * `add island <name> facade` — the contract-module pattern: a shell-safe
 * `${name}.island.ts` exports { app, worker }; the lazy facade imports it,
 * so the worker entry (and the app's dependency graph) only loads on mount.
 */
export function islandFacadeFiles(name: string, fw: Framework, dir = 'src/islands'): OutFile[] {
  const P = pascal(name);
  const ext = ISLAND_EXT[fw] ?? 'ts';
  const contract = (appLine: string): string => `/**
 * ${name} island contract — shell-safe: the app reference + the worker
 * factory. Never import ./${name}.worker.${ext} here — definePolyWorker
 * installs worker-side globals on evaluation.
 */
${appLine}
export const worker = () =>
  new Worker(new URL('./${name}.worker.${ext}', import.meta.url), { type: 'module' });
`;
  switch (fw) {
    case 'react':
    case 'solid': {
      const isReact = fw === 'react';
      const sig = isReact ? 'useState' : 'createSignal';
      const poly = isReact ? 'defineReactPolyWorker' : 'defineSolidPolyWorker';
      const pkg = `@atolljs/${fw}-island/worker`;
      return [
        {
          path: `${dir}/${name}.app.tsx`,
          content: `import { ${sig} } from '${isReact ? 'react' : 'solid-js'}';
import { islandApp } from '@atolljs/islands/worker';
import { emit } from '${pkg}';

/**
 * ${P}App — a real ${isReact ? 'React' : 'Solid'} component rendered INSIDE
 * the worker. islandApp stamps the registry key (minification-proof); state
 * never leaves the worker, DOM ops stream to the shell driver.
 */
export const ${P}App = islandApp('${name}', function ${P}(${
            isReact ? `{ label = '${name}' }: { label?: string }` : `props: { label?: string }`
          }) {
  ${isReact ? 'const [count, setCount] = useState(0);' : 'const [count, setCount] = createSignal(0);'}
  return (
    <button
      onClick={() => {
        const n = ${isReact ? 'count' : 'count()'} + 1;
        setCount(n);
        emit('incremented', { count: n });
      }}
    >
      ${isReact ? `{label}: {count}` : `{props.label ?? '${name}'}: {count()}`}
    </button>
  );
});
`,
        },
        {
          path: `${dir}/${name}.worker.${ext}`,
          content: `import { ${poly} } from '${pkg}';
import { ${P}App } from './${name}.app';

/** One worker, many islands — add apps to the registry. */
export const worker = ${poly}({ apps: { ${name}: ${P}App } });
`,
        },
        {
          path: `${dir}/${name}.island.ts`,
          content: contract(`export { ${P}App as app } from './${name}.app';`),
        },
      ];
    }
    case 'vue': {
      const [component] = islandFiles(name, 'vue', dir); // reuse the SFC
      return [
        component,
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { defineVuePolyWorker } from '@atolljs/vue-island/worker';
import ${P} from './${P}.vue';

/** One worker, many islands — add apps to the registry. */
export const worker = defineVuePolyWorker({ apps: { ${name}: ${P} } });
`,
        },
        {
          path: `${dir}/${name}.island.ts`,
          content: contract(`export const app = '${name}';`),
        },
      ];
    }
    case 'svelte': {
      const [component] = islandFiles(name, 'svelte', dir); // reuse the SFC
      return [
        component,
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { defineSveltePolyWorker } from '@atolljs/svelte-island/worker';
import ${P} from './${P}.svelte';

/** One worker, many islands — add apps to the registry. */
export const worker = defineSveltePolyWorker({ apps: { ${name}: ${P} } });
`,
        },
        {
          path: `${dir}/${name}.island.ts`,
          content: contract(`export const app = '${name}';`),
        },
        {
          path: `${dir}/${P}Island.svelte`,
          content: `<script lang="ts">
  import { island } from '@atolljs/svelte-island';
  import { app, worker } from './${name}.island';

  // The facade component — attrs serialize to worker props on mount.
  let { label = '${name}' }: { label?: string } = $props();
</script>

<div use:island={{ app, worker, props: { label } }} />
`,
        },
      ];
    }
    case 'angular':
      return [
        {
          path: `${dir}/${name}.component.ts`,
          content: `import { Component, input, output } from '@angular/core';
import { AngularIsland } from '@atolljs/angular-island/worker';

/**
 * ${P}Component — rendered inside the worker by Angular's own engine.
 * @AngularIsland stamps the registry key and registers the component, so
 * defineAngularPolyWorker() collects it with no hand-kept apps map.
 */
@AngularIsland('${name}')
@Component({
  standalone: true,
  template: \`
    <button (click)="increment()">{{ label() }}: {{ count }}</button>
  \`,
})
export class ${P}Component {
  label = input('${name}');
  /** Root output() fields bridge to the shell's island event channel. */
  incremented = output<{ count: number }>();
  count = 0;
  increment() {
    this.count += 1;
    this.incremented.emit({ count: this.count });
  }
}
`,
        },
        {
          path: `${dir}/${name}.worker.ts`,
          content: `import { defineAngularPolyWorker } from '@atolljs/angular-island/worker';
import './${name}.component'; // registers via @AngularIsland

/** One worker, many islands — decorated components self-register. */
export const worker = defineAngularPolyWorker();
`,
        },
        {
          path: `${dir}/${name}.island.ts`,
          content: `import { islandComponent } from '@atolljs/angular-island';
import type { ${P}Component } from './${name}.component';

/**
 * ${name} island facade — a standalone component typed off the worker
 * component's input()/output() contract. Use <${name}-island> in templates.
 */
export const ${P}Island = islandComponent<${P}Component>({
  app: '${name}',
  selector: '${name}-island',
  worker: () =>
    new Worker(new URL('./${name}.worker.ts', import.meta.url), { type: 'module' }),
});
`,
        },
      ];
    default:
      return [];
  }
}

/** Shell-side usage hint for the facade variant. */
export function islandFacadeUsage(name: string, fw: Framework): string {
  const P = pascal(name);
  switch (fw) {
    case 'react':
      return `import { Suspense } from 'react';
import { lazyIsland } from '@atolljs/react-island';

const ${P}Island = lazyIsland(() => import('./islands/${name}.island'));

<Suspense fallback={null}>
  <${P}Island label="${name}" onEvent={(n, p) => console.log(n, p)} />
</Suspense>`;
    case 'vue':
      return `<script setup>
import { lazyIsland } from '@atolljs/vue-island';
const ${P}Island = lazyIsland(() => import('./islands/${name}.island'));
</script>

<template>
  <${P}Island label="${name}" />
</template>`;
    case 'solid':
      return `import { lazyIsland } from '@atolljs/solid-island';

const ${P}Island = lazyIsland(() => import('./islands/${name}.island'));

<${P}Island label="${name}" />`;
    case 'svelte':
      return `<script lang="ts">
  import ${P}Island from './islands/${P}Island.svelte';
</script>

<${P}Island label="${name}" />`;
    case 'angular':
      return `import { ${P}Island } from './islands/${name}.island';
// add ${P}Island to the host component's imports, then:
// <${name}-island [props]="{ label: '${name}' }" (incremented)="onIncremented($event)" />`;
    default:
      return '';
  }
}

/* ── nestjs (`atoll add nestjs <level> <name>`) ─────────────────────────── */

/**
 * The pool boundary module + worker entry — shared by `service` (class
 * facade), `module` (boundary only), and referenced by `method`.
 * The module is symmetric: the app imports it for DI, each worker boots it
 * via runAtollWorker.
 */
export function nestjsModuleFiles(
  name: string,
  dir: string,
  opts: { service?: string; mem?: MemRef | null },
): OutFile[] {
  const P = pascal(name);
  const memImport = opts.mem ? `import { ${opts.mem.export_} } from '${opts.mem.import_}';\n` : '';
  const serviceImport = opts.service
    ? `import { ${opts.service} } from './${name}.service';\n`
    : '';
  const memLine = opts.mem
    ? `      sharedMemory: ${opts.mem.export_},\n`
    : `      // message-only — add sharedMemory: <contract> to give the pool a buffer\n`;
  const providers = opts.service
    ? `  providers: [${opts.service}],\n  exports: [${opts.service}, AtollModule],\n`
    : '';
  return [
    {
      path: `${dir}/${name}.module.ts`,
      content: `import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';
${serviceImport}${memImport}
/**
 * ${name} pool boundary — the feature module owns its worker domain.
 * Imported by AppModule for the API thread (registerPool spawns workers)
 * and by the worker entry (runAtollWorker boots the same module in-thread).
 */
@Module({
  imports: [
    AtollModule.registerPool({
      name: '${name}',
      // webpack emits the worker entry as its own chunk — keep the URL inline
      worker: () => new Worker(new URL('./${name}.worker.ts', import.meta.url)),
${memLine}      poolSize: 'auto',
    }),
  ],
${providers}})
export class ${P}Module {}
`,
    },
    {
      path: `${dir}/${name}.worker.ts`,
      content: `// Worker entry — boots a Nest application context inside the worker and
// binds every @AtollService/@AtollTask provider in ${P}Module.
import { runAtollWorker } from '@atolljs/nestjs/worker';
import { ${P}Module } from './${name}.module';

void runAtollWorker(${P}Module);
`,
    },
  ];
}

/**
 * `add nestjs service <name>` — the @AtollService facade: every method
 * dispatches to the pool, consumers inject it with zero Atoll imports.
 * Emits the service plus the pool module + worker entry it runs in.
 */
export function nestjsServiceFiles(
  name: string,
  dir: string,
  mem: MemRef | null,
): OutFile[] {
  const P = pascal(name);
  const memImport = mem ? `import { ${mem.export_} } from '${mem.import_}';\n` : '';
  const memWrite = mem
    ? `\n    // shared memory crosses without a message — pick a real field:\n    // ${mem.export_}.signals.progress.write(100);`
    : '';
  return [
    {
      path: `${dir}/${name}.service.ts`,
      content: `import { Injectable } from '@nestjs/common';
import { threadId } from 'node:worker_threads';
import { AtollService } from '@atolljs/nestjs/decorators';
${memImport}
/**
 * Service-level facade — the class IS the interop surface. Consumers inject
 * it like any provider; every call dispatches to the '${name}' pool as a
 * ${P}Service.method task and the body runs on the worker's DI'd instance.
 */
@Injectable()
@AtollService({ pool: '${name}' })
export class ${P}Service {
  /** Runs inside the worker — the return value crosses postMessage. */
  async echo(input: string) {${memWrite}
    return { heard: input, worker: threadId };
  }
}
`,
    },
    ...nestjsModuleFiles(name, dir, { service: `${P}Service`, mem }),
  ];
}

/**
 * `add nestjs method <name>` — method-level offload via @AtollTask: only
 * decorated methods dispatch; the rest of the class runs on the API thread.
 */
export function nestjsMethodFiles(name: string, dir: string): OutFile[] {
  const P = pascal(name);
  return [
    {
      path: `${dir}/${name}.service.ts`,
      content: `import { Injectable } from '@nestjs/common';
import { threadId } from 'node:worker_threads';
import { AtollTask } from '@atolljs/nestjs/decorators';

/**
 * Method-level offload — only decorated methods dispatch to the pool; the
 * rest of the class stays on the API thread. The body executes inside the
 * worker's own Nest context on the DI-resolved instance.
 */
@Injectable()
export class ${P}Service {
  @AtollTask({ pool: '${name}' })
  async run(input: string) {
    return { heard: input, worker: threadId };
  }

  /** Not decorated — plain main-thread method. */
  describe() {
    return '${name} service, partial offload';
  }
}
`,
    },
  ];
}

/**
 * `add nestjs housed <name>` — a route subtree that exists ONLY inside pool
 * workers: dedicated HTTP worker (NestFactory + serveHttp), a worker-side
 * API module, a controller, and the main-side pool registration.
 */
export function nestjsHousedFiles(name: string, dir: string): OutFile[] {
  const P = pascal(name);
  return [
    {
      path: `${dir}/${name}-atoll.module.ts`,
      content: `// Main-side boundary — registers the '${name}' pool the housed API
// runs in. Message-only by default; to share another pool's buffer, wrap
// the factory:
//   worker: withSharedBuffer(
//     () => new Worker(new URL('./${name}.worker.ts', import.meta.url)),
//     () => getAtollPool('<other-pool>')?.sharedBuffer,
//   )
import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';

@Module({
  imports: [
    AtollModule.registerPool({
      name: '${name}',
      worker: () => new Worker(new URL('./${name}.worker.ts', import.meta.url)),
      poolSize: 2,
    }),
  ],
})
export class ${P}AtollModule {}
`,
    },
    {
      path: `${dir}/${name}.worker.ts`,
      content: `// Dedicated HTTP worker — NOT a task worker: it serves requests, so no
// runAtollWorker. serveHttp binds an internal 127.0.0.1 port and announces
// it via the HTTP_PORT handshake; a respawned worker re-announces.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { serveHttp } from '@atolljs/node/http';
import { ${P}ApiModule } from './${name}-api.module';

void (async () => {
  const app = await NestFactory.create(${P}ApiModule, { logger: ['warn', 'error'] });
  await app.init();
  serveHttp(app.getHttpServer(), { listen: 0 });
})();
`,
    },
    {
      path: `${dir}/${name}-api.module.ts`,
      content: `// Worker-side module — pure HTTP surface (controllers/providers only).
// No registerPool import: pools only exist on the main thread.
import { Module } from '@nestjs/common';
import { ${P}Controller } from './${name}.controller';

@Module({ controllers: [${P}Controller] })
export class ${P}ApiModule {}
`,
    },
    {
      path: `${dir}/${name}.controller.ts`,
      content: `import { Controller, Get } from '@nestjs/common';
import { threadId } from 'node:worker_threads';

/**
 * Housed controller — exists ONLY inside '${name}' pool workers. The main
 * app never sees these routes: it proxies /api/${name}/* into the workers'
 * internal listeners, so decorators, DI, and guards execute off-thread.
 */
@Controller('api/${name}')
export class ${P}Controller {
  /** Which pool worker owns this request. */
  @Get('whoami')
  whoami() {
    return { worker: threadId };
  }
}
`,
    },
  ];
}

/** Gateway wiring printed after `add nestjs housed` — belongs in main.ts. */
export function nestjsHousedWiring(name: string): string {
  return `main.ts — proxy the prefix into the pool:

  import { getAtollPool } from '@atolljs/nestjs';
  import { proxyToWorker, workerHttpPorts } from '@atolljs/node/http';

  const pool = getAtollPool('${name}');
  if (pool) {
    const tracker = workerHttpPorts(pool);
    app.use('/api/${name}', proxyToWorker({
      pool,
      tracker,
      to: '/api/${name}',   // express strips the mount — restore it in-worker
    }));
  }`;
}

/* ── nextjs (`atoll add nextjs <kind> <name>`) ──────────────────────────── */

/**
 * `add nextjs route <name> [task|client]` — a Node-runtime route handler
 * backed by a node:worker_threads pool. `task` = TaskRegistry contract
 * dispatch; `client` = defineWorker + typed workerClient.
 */
export function nextjsRouteFiles(
  name: string,
  dir: string,
  variant: 'task' | 'client',
): OutFile[] {
  const c = camel(name);
  const P = pascal(name);
  const workerFactory = `createNodeWorker(
        new Worker(new URL('./${name}.worker.ts', import.meta.url)),
      )`;
  if (variant === 'task') {
    return [
      {
        path: `${dir}/${name}.contract.ts`,
        content: `import { z } from 'zod';
import { defineSharedMemory, field, type TaskContract } from '@atolljs/core';

/** Pool-owned shared state — the route handler reads it with zero dispatch. */
export const ${c}Memory = defineSharedMemory({
  jobsDone: field.number(),
});

const result = z.object({
  echo: z.string(),
  ms: z.number(),
  jobsDone: z.number(),
});

/** Executed inside a worker via TaskRegistry. */
export const ${P}Job: TaskContract<[input?: string], z.infer<typeof result>> = {
  taskId: '${name}.run',
  resultSchema: result,
};
`,
      },
      {
        path: `${dir}/${name}.worker.ts`,
        content: `// Worker entry — the shim MUST be first: it binds self = parentPort
// before workerBootstrap wires INIT_MEMORY / EXECUTE_TASK.
import '@atolljs/node/shim';
import '@atolljs/core/worker/workerBootstrap';
import { TaskRegistry } from '@atolljs/core';
import { ${c}Memory, ${P}Job } from './${name}.contract';

TaskRegistry.register(${P}Job, (input = '${name}') => {
  const t0 = performance.now();
  const jobs = ${c}Memory.jobsDone.read() + 1;
  ${c}Memory.jobsDone.write(jobs);
  return { echo: \`worker heard: \${input}\`, ms: performance.now() - t0, jobsDone: jobs };
});
`,
      },
      {
        path: `${dir}/pool.ts`,
        content: `import { Worker } from 'node:worker_threads';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { ${c}Memory, ${P}Job } from './${name}.contract';

const create = () => {
  const pool = createNodePool({
    sharedMemory: ${c}Memory,
    poolSize: 'auto',
    tasks: { run: ${P}Job },
    createWorker: () =>
      ${workerFactory},
  });
  // Read memory via this getter — Next compiles module graphs per route
  // layer, so a fresh contract import can be a second, unbound instance.
  return { pool, memory: ${c}Memory };
};

// Module scope = process scope; globalThis survives dev-mode HMR reloads.
export const get${P} = (): ReturnType<typeof create> => {
  const g = globalThis as { __atoll${P}?: ReturnType<typeof create> };
  return (g.__atoll${P} ??= create());
};
`,
      },
      {
        path: `${dir}/route.ts`,
        content: `import { NextResponse } from 'next/server';
import { get${P} } from './pool';

// worker_threads need the Node.js runtime — Edge cannot spawn them.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/${name} {"input": "..."} — dispatch the task into the pool. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await get${P}().pool.run(body?.input));
}

/** GET /api/${name} — read shared state on this thread, no dispatch. */
export async function GET() {
  return NextResponse.json({ jobsDone: get${P}().memory.jobsDone.read() });
}
`,
      },
    ];
  }
  // 'client' variant — defineWorker + typed workerClient
  return [
    {
      path: `${dir}/${name}.contract.ts`,
      content: `import { defineSharedMemory, field } from '@atolljs/core';

/** Pool-owned shared state — the route handler reads it with zero dispatch. */
export const ${c}Memory = defineSharedMemory({
  jobsDone: field.number(),
});
`,
    },
    {
      path: `${dir}/${name}.worker.ts`,
      content: `// Worker entry — shim first, then defineWorker installs the message loop.
import '@atolljs/node/shim';
import { defineWorker, serviceMethod } from '@atolljs/core';
import { z } from 'zod';
import { ${c}Memory } from './${name}.contract';

const echo = serviceMethod({
  def: { argsSchema: z.tuple([z.string()]), resultSchema: z.string() },
  run: (message) => {
    ${c}Memory.jobsDone.write(${c}Memory.jobsDone.read() + 1);
    return \`worker heard: \${message}\`;
  },
});

export const ${c}Worker = defineWorker({
  sharedMemory: ${c}Memory,
  methods: { echo },
});
export type ${P}Worker = typeof ${c}Worker;
`,
    },
    {
      path: `${dir}/pool.ts`,
      content: `import { Worker } from 'node:worker_threads';
import { workerClient } from '@atolljs/core';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { ${c}Memory } from './${name}.contract';
// Type-only — worker code must not leak into the server bundle.
import type { ${P}Worker } from './${name}.worker';

const create = () => {
  const pool = createNodePool({
    sharedMemory: ${c}Memory,
    poolSize: 'auto',
    createWorker: () =>
      ${workerFactory},
  });
  // Read memory via this getter — Next compiles module graphs per route
  // layer, so a fresh contract import can be a second, unbound instance.
  return { pool, client: workerClient<${P}Worker>(pool), memory: ${c}Memory };
};

// Module scope = process scope; globalThis survives dev-mode HMR reloads.
export const get${P} = (): ReturnType<typeof create> => {
  const g = globalThis as { __atoll${P}?: ReturnType<typeof create> };
  return (g.__atoll${P} ??= create());
};
`,
    },
    {
      path: `${dir}/route.ts`,
      content: `import { NextResponse } from 'next/server';
import { get${P} } from './pool';

// worker_threads need the Node.js runtime — Edge cannot spawn them.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/${name} {"input": "..."} — a typed client call into the pool. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({
    echo: await get${P}().client.echo(String(body?.input ?? '${name}')),
  });
}

/** GET /api/${name} — read shared state on this thread, no dispatch. */
export async function GET() {
  return NextResponse.json({ jobsDone: get${P}().memory.jobsDone.read() });
}
`,
    },
  ];
}

/**
 * `add nextjs component <name>` — a 'use client' component bound to the
 * ${name} pool via useTask/useSharedValue. Expects the client + contract
 * from `add nextjs worker <name>` beside it.
 */
export function nextjsComponentFiles(
  name: string,
  dir: string,
  mem: MemRef | null,
): OutFile[] {
  const c = camel(name);
  const P = pascal(name);
  return [
    {
      path: `${dir}/${name}.tsx`,
      content: `'use client';
import { useTask${mem ? ', useSharedValue' : ''} } from '@atolljs/nextjs';
import { ${c} } from './${name}';
${mem ? `import { ${mem.export_} } from '${mem.import_}';\n` : ''}
/**
 * ${P} — a client component over the ${name} pool. Field reads return
 * undefined until the contract binds on the client (SSR-safe).
 */
export function ${P}() {
  const echo = useTask(${c}.echo);${
    mem
      ? `\n  const progress = useSharedValue(${mem.export_}, 'signals.progress');`
      : ''
  }
  return (
    <button onClick={() => echo.run('ping')}>
      {echo.data ?? (echo.pending ? 'working\\u2026' : '${name}')}
    </button>
  );
}
`,
    },
  ];
}

/**
 * `add nextjs instrumentation <name>` — the server bootstrap hook: warms the
 * named route pool at boot instead of inside the first unlucky request.
 */
export function nextjsInstrumentationFile(name: string, dir = 'src'): OutFile {
  const P = pascal(name);
  return {
    path: `${dir}/instrumentation.ts`,
    content: `/**
 * Next.js server bootstrap — runs once when the Node.js runtime boots.
 * Dynamic imports keep node:worker_threads out of the edge/browser bundles.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { get${P} } = await import('./app/api/${name}/pool');
  get${P}(); // spawn workers + bind the buffer during startup, not per request
}
`,
  };
}

