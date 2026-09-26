import { CodeBlock } from '../components/CodeBlock';
import taskDefs from '../../../packages/incidents/src/tasks.ts?raw';

const OBSERVE = `import { observe } from '@jwhenry123/mesh/sdk';

// ObservableValue<T> — get() + subscribe(). Binds lazily: undefined until the
// contract is bound, activates its watch when bind() lands.
const progress = observe(incidentsMemory, 'seedProgress');
const stop = progress.subscribe((v) => console.log(v));`;

const WATCH = `import { reactive, watch } from '@jwhenry123/mesh/sdk';

// Low-level: observe writes through the shared version counter.
const unwatch = watch(incidentsMemory.metrics, (m) => render(m));

// Selector form — callback only fires when the slice changes.
watch(incidentsMemory.metrics, (m) => m.critical, (n) => alert(n));

// reactive() gives a signal-tracked connector (solid-js under the hood):
// get() is tracked, set() writes through, observeRemote() polls the counter.
const conn = reactive(incidentsMemory.seedProgress);`;

const TASK = `import { defineTask } from '@jwhenry123/mesh/sdk';

// Latest-wins async runner: rapid re-runs drop stale results.
// Snapshot: { data, pending, settled, elapsedMs, error }.
export const queryTask = defineTask((q: QueryArgs) => pool.queryIncidents(q));

queryTask.run({ offset: 0, /* ... */ });   // fire a run
queryTask.runOnce();                       // no-op if pending/settled
queryTask.subscribe((snap) => console.log(snap.pending));`;

const LOGGING = `import { scoped, setLogLevel, setLogSink } from '@jwhenry123/mesh/sdk';

const log = scoped('my-domain');
log.debug('...', { detail: 1 });

setLogLevel('debug');                     // trace|debug|info|warn|error
setLogSink((entry) => myTelemetry(entry)); // route logs anywhere`;

export function Reactivity() {
  return (
    <article>
      <h1>Reactivity &amp; tasks</h1>
      <p className="lead">
        The sdk's reactivity layer is framework-neutral: everything reduces to{' '}
        <code>ObservableValue</code> — <code>get()</code> + <code>subscribe()</code> —
        which each <code>@jwhenry123/mesh/*</code> binding adapts to its framework.
      </p>

      <h2>observe() — fields as snapshots</h2>
      <CodeBlock code={OBSERVE} />
      <p>
        <code>observe(memory, key)</code> is the primitive bindings consume. It's safe
        before bind (returns <code>undefined</code>, activates on{' '}
        <code>onBound</code>), snapshot-stable (get() only re-reads when the shared
        version counter moved), and refcounted (watch starts on the first subscriber,
        stops on the last unsubscribe).
      </p>

      <h2>watch() / reactive() — low-level</h2>
      <CodeBlock code={WATCH} />

      <h2>defineTask() — latest-wins async</h2>
      <CodeBlock code={TASK} />
      <p>
        The same runner backs the domain's task definitions — the incidents package
        defines these once and every framework shares them:
      </p>
      <CodeBlock code={taskDefs} file="packages/incidents/src/tasks.ts" />

      <h2>Logging</h2>
      <CodeBlock code={LOGGING} />
    </article>
  );
}
