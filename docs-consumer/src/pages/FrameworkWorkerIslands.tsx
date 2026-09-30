// Embedded sources — ?raw inlines the real files so the docs always show
// the code that ships in this repo.
import shellVue from '../../../examples/react-dom-worker/src/vue/Shell.vue?raw';
import shellSolid from '../../../examples/react-dom-worker/src/solid-shell.ts?raw';
import shellSvelte from '../../../examples/react-dom-worker/src/svelte/Shell.svelte?raw';
import shellAngular from '../../../examples/react-dom-worker/src/angular-shell.ts?raw';
import workerVue from '../../../examples/react-dom-worker/src/worker/vue.worker.ts?raw';
import workerVueCounter from '../../../examples/react-dom-worker/src/worker/vue/Counter.vue?raw';
import workerVueIncidents from '../../../examples/react-dom-worker/src/worker/vue/Incidents.vue?raw';
import workerSolid from '../../../examples/react-dom-worker/src/worker/solid.worker.ts?raw';
import workerSvelte from '../../../examples/react-dom-worker/src/worker/svelte.worker.ts?raw';
import workerSvelteCounter from '../../../examples/react-dom-worker/src/worker/svelte/Counter.svelte?raw';
import workerSvelteIncidents from '../../../examples/react-dom-worker/src/worker/svelte/Incidents.svelte?raw';
import workerAngular from '../../../examples/react-dom-worker/src/worker/angular.worker.ts?raw';
import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';
import type { ReactNode } from 'react';

interface ApiRow {
  name: string;
  signature: ReactNode;
  description: string;
}

interface FrameworkWorkerIslandsConfig {
  name: string;
  pkg: string;
  /** Shell mount surface — used in the lead and headings. */
  surface: ReactNode;
  /** Demo page + embedded source. */
  shellPath: string;
  shellFile: string;
  shellLanguage: string;
  shellSource: string;
  /** The worker-side entry (+ any component files worth showing). */
  workerSources: { file: string; language: string; code: string }[];
  /** One-line description of the demo's client/worker layout. */
  topology: string;
  /** How props updates flow on this binding. */
  propsNote: string;
  api: ApiRow[];
  notes: ReactNode[];
}

const CONFIGS: Record<string, FrameworkWorkerIslandsConfig> = {
  vue: {
    name: 'Vue',
    pkg: '@atolljs/vue-island',
    surface: <code>&lt;AtollIsland/&gt;</code>,
    shellPath: '/vue-shell.html',
    shellFile: 'examples/react-dom-worker/src/vue/Shell.vue',
    shellLanguage: 'vue',
    shellSource: shellVue,
    workerSources: [
      {
        file: 'examples/react-dom-worker/src/worker/vue.worker.ts',
        language: 'ts',
        code: workerVue,
      },
      {
        file: 'examples/react-dom-worker/src/worker/vue/Counter.vue',
        language: 'vue',
        code: workerVueCounter,
      },
      {
        file: 'examples/react-dom-worker/src/worker/vue/Incidents.vue',
        language: 'vue',
        code: workerVueIncidents,
      },
    ],
    topology:
      'the two counters share ONE client — both mounts live in a single worker (counter@N keys, one OS thread); notes and the incidents benchmark each get their own worker on the same script',
    propsNote:
      'passes a plain or reactive() object — the binding watches it and pushes updateProps, deduped by serialized identity',
    api: [
      {
        name: 'AtollIsland',
        signature: <code>h(AtollIsland, {'{'} client|worker, app, props, slots, onEvent, onActivity, onReady, onError {'}'})</code>,
        description:
          'Component form — renders the host div itself (class/id attrs fall through onto it). props may be a reactive() object or getter; the on* callbacks are read at call time, so fresh closures never remount.',
      },
      {
        name: 'useIsland',
        signature: <code>useIsland(options): {'{'} host, handle, status, error {'}'}</code>,
        description:
          'Headless composable — assign host via :ref on your own element. Scope disposal (unmount, effectScope.stop) destroys the island.',
      },
      {
        name: 'islandComponent',
        signature: <code>islandComponent&lt;P&gt;(app?): Component</code>,
        description:
          'Proxy component — mounts a worker app the shell never imports; attributes that aren\'t shell keys become the island props: <ChartsIsland :worker="w" :width="520"/>.',
      },
      {
        name: 'lazyIsland',
        signature: <code>lazyIsland(() =&gt; import(&apos;./worker/apps&apos;)): Component</code>,
        description:
          'defineAsyncComponent-based lazy variant — a bundle split point; resolves { default: app } or contract modules { app, worker } that carry their own worker factory.',
      },
      {
        name: 'defineVuePolyWorker',
        signature: <code>defineVuePolyWorker({'{'} apps {'}'})</code>,
        description:
          'Registry worker — one script serving a whole apps map; islands mount by name and several may share one client. Plain components wrap through vueIslandApp automatically.',
      },
      {
        name: 'defineVueMonoWorker',
        signature: <code>defineVueMonoWorker(Component)</code>,
        description:
          'Instance worker — the 1:1 topology: one script, one app, mounted namelessly. Its bundle carries only that app\'s dependencies.',
      },
      {
        name: 'vueIslandApp / emit',
        signature: <code>vueIslandApp(Component) / emit(name, payload)</code>,
        description:
          'The adapter for shared framework-agnostic registries, and the island → shell event channel (re-exported from the /worker entry).',
      },
    ],
    notes: [
      <>Mounting is async — the host div commits immediately and the worker&apos;s first op batch fills it; no Suspense-style fallback plumbing is needed.</>,
      <><code>client</code>/<code>worker</code>/<code>app</code>/<code>slots</code> are mount-stable — swap them via <code>key</code>/<code>v-if</code>, not mid-life.</>,
      <>Vue&apos;s scheduler is a microtask — state-driven re-renders commit just after the dispatch task returns; their ops ride the doorbell/flush path.</>,
      <>The demo is real SFCs end to end — the shell is <code>Shell.vue</code> and the worker registry serves <code>.vue</code> components; the same bundler plugin (<code>worker.plugins</code>) compiles both sides.</>,
    ],
  },
  solid: {
    name: 'Solid',
    pkg: '@atolljs/solid-island',
    surface: <code>Island()</code>,
    shellPath: '/solid-shell.html',
    shellFile: 'examples/react-dom-worker/src/solid-shell.ts',
    shellLanguage: 'ts',
    shellSource: shellSolid,
    workerSources: [
      {
        file: 'examples/react-dom-worker/src/worker/solid.worker.ts',
        language: 'ts',
        code: workerSolid,
      },
    ],
    topology:
      'the two counters share ONE client — both mounts live in a single worker (counter@N keys, one OS thread); notes and the incidents benchmark each get their own worker on the same script',
    propsNote:
      'passes an accessor — props: () => ({…}) is tracked, so signal reads push updateProps fine-grained, deduped by serialized identity',
    api: [
      {
        name: 'Island',
        signature: <code>Island(options): HTMLElement</code>,
        description:
          'Component form — returns the host element directly, so it works with or without JSX. In JSX it&apos;s <Island app worker props onEvent/>; called directly it hands back a div to insert.',
      },
      {
        name: 'createIsland',
        signature: <code>createIsland(options): {'{'} ref, handle, status, error, updateProps {'}'}</code>,
        description:
          'The composable — wire ref to a container and the owner tree owns the lifecycle. props accepts an accessor for reactive pushes.',
      },
      {
        name: 'defineSolidPolyWorker',
        signature: <code>defineSolidPolyWorker({'{'} apps {'}'})</code>,
        description:
          'Registry worker — apps render through solid-js/universal, so signal writes produce minimal op batches.',
      },
      {
        name: 'defineSolidMonoWorker',
        signature: <code>defineSolidMonoWorker(Component)</code>,
        description: 'Instance worker — the 1:1 topology, mounted namelessly.',
      },
      {
        name: 'solidIslandApp / emit',
        signature: <code>solidIslandApp(Component) / emit(name, payload)</code>,
        description:
          'The adapter for shared framework-agnostic registries, and the island → shell event channel.',
      },
    ],
    notes: [
      <>The shell demo uses <code>solid-js/html</code> tagged templates — real Solid reactivity (<code>insert</code>/<code>effect</code>) with no JSX transform on the shell side.</>,
      <><code>app</code>/<code>worker</code>/<code>client</code> are mount-stable — remount by rebinding the ref to a different element or via keyed control flow.</>,
      <>Worker-side props arrive as per-key signal getters — updates patch exactly the reads that changed.</>,
      <>Pin the client build in worker bundles: <code>resolve: {'{'} alias: {'{'} &apos;solid-js&apos;: &apos;solid-js/dist/solid.js&apos; {'}}'}</code> — the worker/node export conditions resolve the SSR build where effects never re-run.</>,
    ],
  },
  svelte: {
    name: 'Svelte',
    pkg: '@atolljs/svelte-island',
    surface: <code>use:island</code>,
    shellPath: '/svelte-shell.html',
    shellFile: 'examples/react-dom-worker/src/svelte/Shell.svelte',
    shellLanguage: 'svelte',
    shellSource: shellSvelte,
    workerSources: [
      {
        file: 'examples/react-dom-worker/src/worker/svelte.worker.ts',
        language: 'ts',
        code: workerSvelte,
      },
      {
        file: 'examples/react-dom-worker/src/worker/svelte/Counter.svelte',
        language: 'svelte',
        code: workerSvelteCounter,
      },
      {
        file: 'examples/react-dom-worker/src/worker/svelte/Incidents.svelte',
        language: 'svelte',
        code: workerSvelteIncidents,
      },
    ],
    topology:
      'each island gets its own client — Svelte schedules render work through ambient document resolution, so mounts on one shared worker can misroute ops',
    propsNote:
      'the action\'s update() hook fires when the options object re-evaluates — props changes push updateProps, deduped by serialized identity',
    api: [
      {
        name: 'island',
        signature: <code>&lt;div use:island={'{'}{'{'} client|worker, app, props, onEvent, slots, onReady {'}'}{'}'} /&gt;</code>,
        description:
          'Action form — mounts on attach, forwards props on update(), destroys on teardown. Callbacks are read through a latest-options ref, so fresh closures never remount.',
      },
      {
        name: 'createIslandState',
        signature: <code>createIslandState(): {'{'} status, error, handle {'}'}</code>,
        description:
          'Headless rune state — spread onto the action options to read status/error/handle reactively.',
      },
      {
        name: 'defineSveltePolyWorker',
        signature: <code>defineSveltePolyWorker({'{'} apps {'}'})</code>,
        description:
          'Registry worker — components must be rune-compiled Svelte 5 (vite-plugin-svelte); they mount through real mount()/unmount() against the proxy document.',
      },
      {
        name: 'defineSvelteMonoWorker',
        signature: <code>defineSvelteMonoWorker(Component)</code>,
        description: 'Instance worker — the 1:1 topology, mounted namelessly.',
      },
      {
        name: 'svelteIslandApp / emit',
        signature: <code>svelteIslandApp(Component) / emit(name, payload)</code>,
        description:
          'The adapter for shared registries, and the island → shell event channel.',
      },
    ],
    notes: [
      <><code>worker</code>/<code>client</code>/<code>app</code> are mount-stable — swap them through a {'{#key}'} block.</>,
      <>Props arriving while the mount is in flight coalesce (last write wins) and flush once the handle lands — nothing is dropped.</>,
      <>Event dispatches end with a flushSync() worker-side, so state updates land in the dispatch&apos;s own op batch.</>,
      <>The shell page is an ordinary Svelte 5 component — the only island-specific piece is the action options object.</>,
    ],
  },
  angular: {
    name: 'Angular',
    pkg: '@atolljs/angular-island',
    surface: <code>islandComponent</code>,
    shellPath: '/angular-shell.html',
    shellFile: 'examples/react-dom-worker/src/angular-shell.ts',
    shellLanguage: 'ts',
    shellSource: shellAngular,
    workerSources: [
      {
        file: 'examples/react-dom-worker/src/worker/angular.worker.ts',
        language: 'ts',
        code: workerAngular,
      },
    ],
    topology:
      'the two counters share ONE baked-in client — both mounts live in a single worker (counter@N keys, one OS thread); notes and incidents bake the worker shorthand, so each facade owns its worker',
    propsNote:
      '[props] is typed as IslandInputs<C> — the worker component\'s own input()/model() fields — so a wrong key or type is a template compile error',
    api: [
      {
        name: 'islandComponent',
        signature: <code>islandComponent&lt;C&gt;({'{'} app, client|worker, selector?, mode? {'}'}): Type&lt;Component&gt;</code>,
        description:
          'The facade — generates a standalone component (&lt;counter-island&gt;) typed against the worker component class via import type. [props] accepts IslandInputs&lt;C&gt;; onEvent narrows per the output()/model() fields.',
      },
      {
        name: 'AngularIsland',
        signature: <code>@AngularIsland | @AngularIsland(&apos;name&apos;) | @AngularIsland({'{'} name?, providers? {'}'})</code>,
        description:
          'Worker-side class decorator — stamps the registry name (default: kebab-cased class name minus Component) and registers the component, so defineAngularPolyWorker() collects the whole set with no apps map.',
      },
      {
        name: 'IslandInputs / IslandEvents / IslandEventHandler',
        signature: <code>IslandInputs&lt;C&gt; · IslandEvents&lt;C&gt; · IslandEventHandler&lt;C&gt;</code>,
        description:
          'Type-only inference from the component class — input()/model() write-types become the props contract; output()/model() payload types become the event map.',
      },
      {
        name: 'AtollIslandComponent / AtollIslandDirective',
        signature: <code>&lt;atoll-island [client|worker] [app] [props] [mode] [onEvent]/&gt; · &lt;div atollIsland …/&gt;</code>,
        description:
          'The low-level surface — generic (AtollIslandComponent&lt;C&gt;) so [app] accepts the stamped component class and props/events infer. worker/workerOptions/mode inputs cover the no-shared-client case.',
      },
      {
        name: 'defineAngularPolyWorker',
        signature: <code>defineAngularPolyWorker() | ({'{'} apps: [C,…] {'}'}) | ({'{'} apps: {'{'} name: C {'}'} {'}'})</code>,
        description:
          'Registry worker — no-arg collects every @AngularIsland in the module graph; the array form names entries by stamp/kebab-cased class name; the record form is unchanged. Renderer2/RendererFactory2 over the proxy document; components mount via createComponent.',
      },
      {
        name: 'defineAngularMonoWorker',
        signature: <code>defineAngularMonoWorker(Component)</code>,
        description: 'Instance worker — the 1:1 topology, mounted namelessly.',
      },
    ],
    notes: [
      <>The worker component&apos;s public API IS the island contract — <code>input()</code>/<code>model()</code> fields become [props] keys, and root <code>output()</code>/<code>model()</code> fields bridge onto the emit channel under their public names (<code>x = model()</code> → <code>&apos;xChange&apos;</code>), with instance re-entry handled by the adapter.</>,
      <><code>import &apos;@angular/compiler&apos;</code> once wherever JIT (decorator) components run — shell AND worker entries. AOT/ɵcmp components skip it; the generated facade component carries a hand-authored ɵcmp so it works under both.</>,
      <>Zoneless: <code>provideZonelessChangeDetection()</code> + signals — no zone.js. Signal writes from island callbacks schedule change detection directly.</>,
      <><code>app</code>/<code>client</code>/<code>worker</code> input changes remount the island; props and <code>mode</code> update in place (mode rides the handle&apos;s setMode).</>,
      <>input()/model()/output() signal fields work on JIT components — but aliased inputs aren&apos;t discoverable; bind by field name or use AOT.</>,
    ],
  },
};

/**
 * Worker islands under a given framework shell — the react-dom-worker
 * example's <fw>-shell.html page, where every island mounts through that
 * framework's @atolljs/<fw>-island shell surface over the SAME worker apps.
 */
export function FrameworkWorkerIslands({ id }: { id: string }) {
  const fw = CONFIGS[id];
  if (!fw) return <article><h1>Unknown framework</h1></article>;
  return (
    <article>
      <h1>{fw.name} — islands</h1>
      <p className="lead">
        <PkgLink name={fw.pkg} /> — a worker-hosted tree mounted as an ordinary
        element in a {fw.name} shell. The worker&apos;s render loop produces
        serialized DOM ops; the main thread just replays them.
      </p>

      <h2>Live demo — {fw.name} in the worker</h2>
      <p>
        Four islands, {fw.name} rendered inside the workers: a counter, a
        second counter instance, a notes composer, and a 1,000,000-record
        incident benchmark — {fw.topology}. The shell is just a thin{' '}
        {fw.surface} host from <PkgLink name={fw.pkg} /> that replays their ops.
      </p>
      <p>
        <b>The incident benchmark is the real-world case for offloading a
        heavy component.</b> One million incidents exist as lazily generated
        logical rows — the component is a fixed-height virtualized scroller
        that renders only the ~22 visible rows plus overscan, no matter where
        you scroll. Each scroll event crosses the island protocol as a
        structured payload (the driver stamps <code>scrollTop</code>), {fw.name}
        re-computes the window worker-side, and the commit rides back as an op
        batch — the stats line reports the worker-side re-render time, and a{' '}
        <code>rendered</code> emit updates the shell&apos;s status line. The
        main thread never touches more than a handful of DOM nodes; a million
        rows of state, generation, and diffing all stay off it.
      </p>
      <DemoFrame
        id="react-dom-worker"
        port={5177}
        name={fw.name}
        path={fw.shellPath}
      />

      <h2>The {fw.name} API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {fw.api.map((row) => (
            <tr key={row.name}>
              <td><code>{row.name}</code></td>
              <td>{row.signature}</td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Mounting — the shell is a thin {fw.name} host</h2>
      <p>
        Every island below mounts against a pre-connected{' '}
        <code>connectIslandWorker({'{'} worker, doorbell {'}'})</code> client.
        Worker emits land in <code>onEvent</code> → shell state → the status
        line; props flow the other way — {fw.propsNote}.
      </p>
      <CodeBlock
        file={fw.shellFile}
        language={fw.shellLanguage}
        code={fw.shellSource}
      />

      <h2>The worker side — {fw.name} running in the worker</h2>
      <p>
        The worker bundle carries {fw.name} itself — the framework&apos;s
        own renderer drives the proxy DOM and state stays worker-side.
        <code>define{fw.name}PolyWorker</code> serves the whole apps map
        from one script; islands mount by registry name. See the{' '}
        <a href={docHref('islands')}>Islands</a> page for modes, slots, and
        lifecycle.
      </p>
      {fw.workerSources.map((w) => (
        <CodeBlock
          key={w.file}
          file={w.file}
          language={w.language}
          code={w.code}
        />
      ))}

      <h2>Notes</h2>
      <ul>
        <li>
          <b>Mediation is unidirectional</b> — an island&apos;s emit lands in{' '}
          <code>onEvent</code>, the shell writes state, and it flows back in as
          props. No hand-wired <code>updateProps</code> calls.
        </li>
        <li>
          <b>Fixed-dimension libs</b> (recharts) get width/height as props —
          there&apos;s no ResizeObserver channel into the worker.
        </li>
        <li>
          <b><code>emit</code> needs instance scope</b> — it routes through the
          active task, so it&apos;s free inside event handlers. Async commit
          hooks (Vue <code>onUpdated</code>, Svelte <code>$effect</code>,
          Angular <code>afterEveryRender</code>) run after the task releases
          it: capture <code>getActiveInstance()</code> during setup and
          re-enter with <code>runInInstance(scope, () =&gt; emit(…))</code> —
          or, in Angular, just declare an <code>output()</code> field and the
          adapter&apos;s output bridging re-enters for you (that&apos;s how the
          incidents benchmark reports its re-render time).
        </li>
        {fw.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </article>
  );
}
