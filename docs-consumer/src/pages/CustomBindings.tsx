import { CodeBlock } from '../components/CodeBlock';

export function CustomBindings() {
  return (
    <article>
      <h1>Custom bindings</h1>
      <p className="lead">
        A binding package (<code>@atolljs/&lt;fw&gt;</code>) is three thin
        adapters over core primitives — <code>observe()</code> for
        shared-memory fields, <code>toTask()</code> for task state, and{' '}
        <code>ObservableValue</code> underneath both. The whole Vue binding is
        ~40 lines; a port's real work is choosing the right reactive primitive
        and the right teardown hook.
      </p>

      <h2>The contract you adapt</h2>
      <CodeBlock
        code={`// @atolljs/core — everything a binding wraps:
interface ObservableValue<T> {
  get(): T;                                  // latest snapshot, sync
  subscribe(fn: (v: T) => void): () => void; // returns unsubscribe
}

observe(memory, key, select?, options?)  // → ObservableValue<field | slice>
toTask(asyncFnOrTask)                    // → AsyncTask, itself an ObservableValue<TaskSnapshot>`}
      />
      <p>
        <code>get()</code> returns <code>undefined</code> until the contract is
        bound and the field written (or the task first runs) — keep the{' '}
        <code>| undefined</code> in your public types, it's the SSR fallback
        story too. <code>subscribe</code> fires on every write, local or
        remote; your adapter's job is to push each emission into a
        framework-tracked cell and unregister it when the surrounding scope
        dies.
      </p>

      <h2>The three adapters</h2>
      <p>
        The canonical minimal port is Vue's —{' '}
        <code>packages/vue/src/index.ts</code> in full:
      </p>
      <CodeBlock
        file="packages/vue/src/index.ts — the template to copy"
        code={`import { onScopeDispose, ref, type Ref } from 'vue';
import { observe, toTask } from '@atolljs/core';

// 1) ObservableValue → framework reactive primitive.
export function useObservable<T>(source: ObservableValue<T>): Ref<T> {
  const value = ref(source.get());
  const stop = source.subscribe((v) => { value.value = v; });
  onScopeDispose(stop);           // ← the framework's teardown hook
  return value;
}

// 2) Shared field → same primitive. observe() does the spec lookup,
//    slicing, and equality; you just re-wrap.
export function useSharedValue(memory, key, select?, options?) {
  return useObservable(observe(memory, key, select, options));
}

// 3) Task → snapshot cell + the trigger pair, passed through untouched.
export function useTask(source) {
  const task = toTask(source);    // AsyncTask | plain async fn — both
  return { state: useObservable(task), run: task.run, runOnce: task.runOnce };
}`}
      />

      <h2>Framework mapping</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Framework</th>
            <th>Reactive primitive</th>
            <th>Teardown hook</th>
            <th>Idiom</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>React / Next.js client</td>
            <td><code>useSyncExternalStore(source.subscribe, source.get)</code></td>
            <td>the returned unsubscribe</td>
            <td><code>use*</code> hooks</td>
          </tr>
          <tr>
            <td>Vue</td>
            <td><code>ref(source.get())</code> + write in subscribe</td>
            <td><code>onScopeDispose(stop)</code></td>
            <td><code>use*</code> composables returning <code>Ref</code>s</td>
          </tr>
          <tr>
            <td>Solid</td>
            <td><code>createSignal(source.get())</code> → accessor</td>
            <td><code>onCleanup(stop)</code></td>
            <td><code>create*</code> factories returning accessors</td>
          </tr>
          <tr>
            <td>Svelte 5</td>
            <td><code>$state</code> box in a <code>.svelte.ts</code> module</td>
            <td>return <code>stop</code> from <code>$effect</code></td>
            <td>factories returning getter objects / rune-backed state</td>
          </tr>
          <tr>
            <td>Angular</td>
            <td><code>signal(source.get())</code> + write in subscribe</td>
            <td><code>inject(DestroyRef).onDestroy(stop)</code></td>
            <td><code>signal*</code>/<code>inject*</code>, DI for pools</td>
          </tr>
          <tr>
            <td><i>yours</i></td>
            <td>whatever subscribes + notifies</td>
            <td>whatever runs on scope/unmount</td>
            <td>match the ecosystem, don't copy React's <code>use</code> prefix</td>
          </tr>
        </tbody>
      </table>

      <h2>Semantics to preserve</h2>
      <ul>
        <li>
          <b>Subscribe once per binding, dispose on scope death.</b> One
          <code>subscribe</code> per hook call; teardown via the framework's
          lifecycle (<code>onScopeDispose</code>, <code>onCleanup</code>,{' '}
          <code>$effect</code> cleanup, <code>DestroyRef</code>) — never a
          manual <code>.destroy()</code> the consumer has to remember.
        </li>
        <li>
          <b><code>select</code> + <code>SliceOptions</code> pass straight
          through.</b> Selectors run on every write — document that they must
          be pure; <code>options.equals</code> is the rerender gate. React
          ships <code>shallowEqual</code>; port it if your ecosystem expects
          object slices.
        </li>
        <li>
          <b><code>run</code>/<code>runOnce</code> keep their identity.</b>{' '}
          Return the task's own methods — never wrap in fresh closures per
          render, or memoized children/API calls destabilize.
        </li>
        <li>
          <b>Sources are created at call time.</b>{' '}
          <code>observe()</code>/<code>toTask()</code> inside the adapter (or
          memoized on first use) — a fresh observable per binding, never a
          shared one at module scope unless the pattern is explicitly
          module-scope state.
        </li>
        <li>
          <b><code>undefined</code> is a legal render.</b> Components mount
          before workers bind; templates must tolerate it. On SSR the
          observable never binds — the fallback <em>is</em> the SSR output.
        </li>
      </ul>

      <h2>Optional: pool plumbing</h2>
      <p>
        Frameworks with dependency injection or context get a second half:
        Angular's <code>AtollModule.forRoot</code>/<code>injectAtollPool</code>,
        React/Vue examples' context-passed clients. The primitives are{' '}
        <code>connectWorker</code> (<code>defineWorker</code> contracts) and{' '}
        <code>connectIslandWorker</code> (island workers) — pass the pool
        through the framework's own provider mechanism and keep the worker
        entry bundler-detectable:{' '}
        <code>new Worker(new URL('./x.worker.ts', import.meta.url))</code>{' '}
        inline.
      </p>

      <h2>Package shape</h2>
      <CodeBlock
        language="json"
        file="packages/<fw>/package.json"
        code={`{
  "name": "@atolljs/<fw>",
  "exports": { ".": "./src/index.ts" },
  "peerDependencies": {
    "@atolljs/core": "0.1.0",
    "<fw>": "^x.y.z"          // the framework is the consumer's install
  }
}`}
      />
      <p>
        One entry, no build config — packages ship <code>src/</code> as
        TypeScript and the consumer's bundler compiles it. Binding code is
        main-thread only: <code>import type</code> worker definitions, never
        the module.
      </p>

      <h2>Testing</h2>
      <CodeBlock
        code={`import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./my.worker')];
// real worker registry + real shared memory; only the thread is faked.
// flushObservers() settles pending notifications between assertions.`}
      />
      <p>
        Port a real demo screen (the counter, then a data layer) — the unit
        tests catch subscription leaks, but only an app catches{" "}
        "re-renders but stale" and "teardown order" bugs.
      </p>
    </article>
  );
}
