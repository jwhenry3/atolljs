import { CodeBlock } from '../components/CodeBlock';

export function Reactivity() {
  return (
    <article>
      <h1>Reactivity</h1>
      <p className="lead">
        The SDK ships framework-neutral observables; the binding packages adapt
        them to each framework's reactivity model.
      </p>

      <h2>observe — a field as an observable</h2>
      <CodeBlock
        code={`import { observe, shallowEqual } from '@atolljs/core/sdk';

const metrics = observe(memory, 'metrics');
metrics.get();                       // undefined until bound + first write
const unsub = metrics.subscribe(v => render(v));

// Slice form — emits only when the selected slice changes:
observe(memory, 'metrics', m => m.critical);
observe(memory, 'metrics', m => ({ open: m.open }), { equals: shallowEqual });`}
      />
      <p>
        <code>get()</code> stays a stable snapshot between emissions — exactly
        what <code>useSyncExternalStore</code>-style adapters need. Subscriptions
        are refcounted: watching starts on first subscriber and stops on last
        unsubscribe. <code>observe()</code> is bind-safe — it activates when the
        contract binds on the thread, so SSR and early renders just see{' '}
        <code>undefined</code>.
      </p>

      <h2>watch — low-level field watching</h2>
      <CodeBlock
        code={`import { watch, reactive } from '@atolljs/core/sdk';

// Whole field:
const stop = watch(memory.connector('metrics'), (m) => console.log(m.critical));

// Slice + custom equality (mute noise below a threshold):
watch(
  memory.connector('latency'),
  (v) => v,
  (v) => console.log(v),
  { equals: (a, b) => Math.abs(a - b) < 10 }
);

// Signal-tracked reads for solid-js-style effects:
const sig = reactive(memory.connector('metrics'));  // sig.get() in effects`}
      />

      <h2>defineTask — async work as observable state</h2>
      <p>
        See <a href="#/tasks">Worker pool &amp; tasks</a>. Each{' '}
        <code>AsyncTask</code> is an <code>ObservableValue</code> of{' '}
        <code>{'{ data, pending, settled, elapsedMs, error }'}</code> — the same
        shape every binding's task adapter consumes.
      </p>

      <h2>Logging</h2>
      <CodeBlock
        code={`import { setLogLevel, setLogSink } from '@atolljs/core/sdk';

setLogLevel('debug');                 // silent | error | info | debug | trace
setLogSink((entry) => myLogger(entry)); // route SDK logs anywhere`}
      />
    </article>
  );
}
