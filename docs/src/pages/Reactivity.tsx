import { CodeBlock } from '../components/CodeBlock';

const OBSERVE = `import { observe } from '@jwhenry123/mesh/sdk';

// ObservableValue<T> — get() + subscribe(). Binds lazily: undefined until the
// contract is bound, activates its watch when bind() lands.
const progress = observe(incidentsMemory, 'signals.seedProgress');
const stop = progress.subscribe((v) => console.log(v));`;

const WATCH = `import { reactive, watch } from '@jwhenry123/mesh/sdk';

// Low-level: observe writes through the shared version counter.
const unwatch = watch(incidentsMemory.state.metrics, (m) => render(m));

// Selector form — callback only fires when the slice changes.
watch(incidentsMemory.state.metrics, (m) => m.critical, (n) => alert(n));

// reactive() gives a signal-tracked connector (solid-js under the hood):
// get() is tracked, set() writes through, observeRemote() polls the counter.
const conn = reactive(incidentsMemory.signals.seedProgress);`;

const TASK = `import { defineTask, toTask } from '@jwhenry123/mesh/sdk';

// Latest-wins async runner: rapid re-runs drop stale results.
// Snapshot: { data, pending, settled, elapsedMs, error }.
const queryTask = defineTask((q: QueryArgs) => incidents.queryIncidents(q));

queryTask.run({ offset: 0, /* ... */ });   // fire a run
queryTask.runOnce();                       // no-op if pending/settled
queryTask.subscribe((snap) => console.log(snap.pending));

// Usually you never call defineTask yourself — every binding's task helper
// accepts a plain async function and wraps it per call site:
//   useTask(incidents.queryIncidents)   // React
//   taskState(incidents.queryIncidents) // Angular / Svelte
// toTask() is the shared normalizer behind them.
const same = toTask(incidents.queryIncidents);`;

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
        which each <code>@jwhenry123/mesh-*</code> binding adapts to its framework.
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

      <h2>defineTask() / toTask() — latest-wins async</h2>
      <CodeBlock code={TASK} />
      <p>
        Task state is per call site, not per module: two components each calling{' '}
        <code>useTask(incidents.queryIncidents)</code> get independent
        pending/data snapshots. Pass a stable function reference — client methods
        are referentially stable, and composite flows (seed then compute) belong in
        a module-level <code>async</code> function like the incidents package's{' '}
        <code>initIncidents</code>.
      </p>

      <h2>Logging</h2>
      <CodeBlock code={LOGGING} />
    </article>
  );
}
