import { CodeBlock } from '../components/CodeBlock';

export function CustomIslandRenderer() {
  return (
    <article>
      <h1>Custom island renderers</h1>
      <p className="lead">
        A <code>@atolljs/&lt;fw&gt;-island</code> package has two halves: a{' '}
        <b>worker adapter</b> that teaches your framework's renderer to draw
        into an island's proxy document, and a <b>shell surface</b> that mounts
        worker islands as ordinary elements in a main-thread app. The op
        protocol, event dispatch, and doorbell all live in{' '}
        <code>@atolljs/islands</code> — you never touch them.
      </p>

      <h2>The contract: RenderedIslandApp</h2>
      <CodeBlock
        file="@atolljs/islands/worker — defineWorkers.ts"
        code={`// What your adapter produces — the registry value shape:
interface RenderedIslandApp {
  mount(ctx: RenderContext): RenderedHandle | void;
}
interface RenderContext {
  instance: string;                    // wire key — scopes emit() and ops
  doc: ProxyDocument;                  // mutations here already emit ops
  props: Record<string, unknown>;      // the serialized mount props
}
interface RenderedHandle {
  update?(props): void;   // fine-grained patch; omit → clear+remount fallback
  sync?(fn): void;        // run fn in your sync-commit lane (React: flushSync)
  flush?(): void;         // drain work scheduled outside tasks (effects)
  dispose?(): void;       // teardown — runs BEFORE the proxy doc dies
}`}
      />
      <p>
        <code>mount</code> renders the component's output into{' '}
        <code>ctx.doc</code> — every proxy mutation serializes to ops on its
        own, so the adapter is only a bridge between your framework's host-op
        interface and the proxy DOM facade. Return a handle for fine-grained
        updates; omit <code>update</code> and the runtime falls back to
        dispose + clear + remount.
      </p>

      <h2>Worker adapter skeleton</h2>
      <CodeBlock
        file="packages/<fw>-island/src/worker.ts"
        code={`import { createRenderer /* or mount(), RendererFactory2, … */ } from '<fw>';
import {
  defineMonoWorker, definePolyWorker, islandApp,
  getActiveInstance, getLastActiveInstance, getLastTouchedInstance,
  docForInstance,
} from '@atolljs/islands/worker';
// Consumers shouldn't need a second specifier for the shell channel:
export { emit, runInInstance } from '@atolljs/islands/worker';

const { render, createApp } = createRenderer<ProxyNode, ProxyElement>({
  createElement: (tag) => docForRender().createElement(tag),
  insert: (el, parent, anchor) => parent.insertBefore(el, anchor ?? null),
  patchProp: (el, key, _prev, next) => { /* class/style/events/attrs */ },
  /* …the rest of your framework's host-op surface… */
});

export function fwIslandApp(Component): RenderedIslandApp {
  return {
    mount({ doc, props }) {
      const app = createApp(Component, props);
      app.mount(doc.body);
      return {
        update: (next) => /* re-render root with REPLACED props */,
        dispose: () => app.unmount(),
      };
    },
  };
}

// Stamped registry value + convenience define* wrappers:
export const fwIsland = (name, C) => islandApp(name, fwIslandApp(C));
export function defineFwPolyWorker({ apps, sharedMemory }) {
  return definePolyWorker({
    apps: Object.fromEntries(
      Object.entries(apps).map(([k, c]) => [k, fwIslandApp(c)])),
    sharedMemory,
  });
}
export const defineFwMonoWorker = (c, opts) =>
  defineMonoWorker(fwIslandApp(c), opts);`}
      />

      <h2>Pitfalls the existing adapters hit</h2>
      <ul>
        <li>
          <b>Realm resolution.</b> Module-level renderers call your create* host
          ops with no node argument — the instance isn't in scope. Resolve the
          document through the chain{' '}
          <code>getActiveInstance() || getLastActiveInstance() ||{' '}
          getLastTouchedInstance()</code> then <code>docForInstance()</code> —
          see <code>docForRender</code> in{' '}
          <code>packages/vue-island/src/worker.ts</code>. This keeps async
          scheduler flushes (microtask commits after the dispatch task
          returns) on the right instance.
        </li>
        <li>
          <b>Event invokers.</b> Attach one stable invoker per (element, event)
          whose <code>.value</code> is the current handler — prop diffs swap
          the closure without re-pushing a <code>listen</code> op. Modifier
          changes (capture/once/passive) are a different listener: detach and
          re-attach with new opts.
        </li>
        <li>
          <b>Form props are property writes.</b>{' '}
          <code>value</code>/<code>checked</code>/<code>disabled</code> are
          reflected accessors on the proxy — write the property, don't{' '}
          <code>setAttribute</code>, or the shadow state and wire ops diverge.
        </li>
        <li>
          <b>Namespaces.</b> Route <code>svg</code>/<code>mathml</code> through{' '}
          <code>createElementNS</code>; the driver tracks them.
        </li>
        <li>
          <b>update() replaces props.</b> Merge semantics keep stale keys
          alive — Vue's adapter cloneVNodes then overwrites{' '}
          <code>vnode.props</code> wholesale for exactly this reason.
        </li>
        <li>
          <b>Instance-less work needs a scope.</b> Timers and promise
          continuations mutating DOM must wrap in{' '}
          <code>runInInstance(instance, fn)</code> +{' '}
          <code>bumpOpsVersion()</code>, or their ops flush to the wrong queue
          — or never.
        </li>
      </ul>

      <h2>The shell half</h2>
      <p>
        Main-thread side is a <code>useIsland</code>-equivalent returning{' '}
        <code>{'{ host, handle, status, error }'}</code> — the template is{' '}
        <code>packages/vue-island/src/index.ts</code>:
      </p>
      <ul>
        <li>
          <b>Mount on non-null host element</b> via{' '}
          <code>mountIsland({'{'} client, el, app, props, onEvent, slots {'}'})</code>;
          destroy + remount if the element swaps (v-if / conditional remount).
        </li>
        <li>
          <b>Reactive props → <code>handle.updateProps</code></b>, deduped by{' '}
          <code>JSON.stringify</code> identity — the serialized form is the
          honest equality since props cross the wire serialized anyway.
        </li>
        <li>
          <b>Mount-stable inputs.</b> <code>client</code>/<code>worker</code>/
          <code>app</code>/<code>slots</code> are read once — document
          "swap via key" rather than mid-life remount.
        </li>
        <li>
          <b>Generation-guard the async mount.</b> A mount that resolves after
          teardown destroys its handle immediately instead of attaching a
          zombie island.
        </li>
        <li>
          <b>Scope disposal destroys.</b> Component unmount / effect-scope
          stop → <code>island.destroy()</code>; shared clients keep the worker
          alive for other mounts.
        </li>
        <li>
          <b>The component wrapper is thin.</b> It reads framework props
          reactively and forwards through the options object, so fresh
          closures never remount the worker.
        </li>
      </ul>

      <h2>Package shape</h2>
      <CodeBlock
        language="json"
        file="packages/<fw>-island/package.json"
        code={`{
  "name": "@atolljs/<fw>-island",
  "exports": {
    ".": "./src/index.ts",      // shell surface — no framework renderer here
    "./worker": "./src/worker.ts"
  },
  "peerDependencies": {
    "@atolljs/core": "0.1.0",
    "@atolljs/islands": "0.1.0",
    "<fw>": "^x.y.z"
  }
}`}
      />
      <p>
        The <code>/worker</code> split is the bundle boundary: a registry
        worker that only mounts other frameworks never parses yours, so
        framework imports belong strictly in the worker entry.
      </p>

      <h2>Pick your starting point</h2>
      <table className="doc-table">
        <thead>
          <tr><th>If your framework…</th><th>Copy</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>has a custom-renderer API (<code>createRenderer</code>-style host ops)</td>
            <td><code>packages/vue-island</code> — smallest, single file</td>
          </tr>
          <tr>
            <td>renders via fine-grained signals / universal renderer</td>
            <td><code>packages/solid-island</code> — per-key signal props box for update()</td>
          </tr>
          <tr>
            <td>compiles to imperative DOM calls with a programmatic mount()</td>
            <td><code>packages/svelte-island</code> — <code>$state</code> props box</td>
          </tr>
          <tr>
            <td>abstracts the DOM behind a Renderer2-style interface + DI</td>
            <td><code>packages/angular-island</code> — <code>setInput</code> + manual CD</td>
          </tr>
          <tr>
            <td>needs a full reconciler host config</td>
            <td><code>packages/react-island</code> — hardest: hostConfig + instance records + sync/flush lanes</td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
