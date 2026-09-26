import { CodeBlock } from '../components/CodeBlock';
import memoryContracts from '../../../packages/incidents/src/contract/memory.contracts.ts?raw';

export function SharedMemory() {
  return (
    <article>
      <h1>Shared memory contracts</h1>
      <p className="lead">
        <code>defineSharedMemory(spec, options?)</code> declares a fixed,
        deterministic layout over a <code>SharedArrayBuffer</code>. Both threads import
        the same object; the pool binds it on the main thread and the worker bootstrap
        binds it inside workers — identical memory on both sides.
      </p>

      <h2>The incidents contract</h2>
      <CodeBlock code={memoryContracts} file="packages/incidents/src/contract/memory.contracts.ts" />

      <h2>Field kinds</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Factory</th><th>Type</th><th>Storage</th></tr>
        </thead>
        <tbody>
          <tr><td><code>field.number()</code></td><td><code>number</code></td><td>8 bytes (f64)</td></tr>
          <tr><td><code>field.boolean()</code></td><td><code>boolean</code></td><td>1 byte stored, descriptor reserves 8</td></tr>
          <tr><td><code>field.string(maxBytes)</code></td><td><code>string</code></td><td>4-byte length + inline UTF-8</td></tr>
          <tr><td><code>field.object(maxBytes, schema?)</code></td><td><code>T</code></td><td>4-byte length + codec-encoded payload</td></tr>
          <tr><td><code>field.array(maxBytes, schema?)</code></td><td><code>T[]</code></td><td>same, element schema optional</td></tr>
          <tr><td><code>field.int32Array(n)</code> / <code>float64Array(n)</code> / <code>bigInt64Array(n)</code> / <code>uint8Array(n)</code></td><td>typed array</td><td>raw view — <code>read()</code> is zero-copy</td></tr>
          <tr><td><code>field.struct(spec, count)</code></td><td>record array</td><td>fixed-layout records; scalar fields + inline <code>{'{ string: n }'}</code></td></tr>
        </tbody>
      </table>

      <h2>Connectors</h2>
      <p>
        Every field exposes a <code>Connector&lt;T&gt;</code>: <code>read()</code> /{' '}
        <code>write(v)</code>, plus a shared <em>version counter</em> bumped by{' '}
        <code>Atomics</code> on each write. That's how the other thread observes
        changes without messages.
      </p>
      <p>
        Struct fields return a <code>StructConnector&lt;R&gt;</code> with record-level
        access: <code>readAt(i, out, fields?)</code>, <code>writeAt(i, record)</code>{' '}
        (partial writes supported via a field list), and <code>commit()</code> to bump
        the version counter after a batch — <code>writeAt</code> is intentionally pure
        memory access.
      </p>

      <h2>Codecs and schemas</h2>
      <p>
        Structured fields encode through the contract's codec —{' '}
        <code>msgpackrCodec</code> (the default: MessagePack with structure
        sharing, the fastest option for uniform records), <code>msgpackCodec</code>,
        or <code>jsonCodec</code>. Optional zod schemas (<code>structSchema</code>,
        object/array <code>schema</code> options) validate values at the boundary.
        Register custom field kinds globally with{' '}
        <code>registerConnectorFactory(kind, factory)</code> or per contract via{' '}
        <code>SharedMemoryOptions.plugins</code>.
      </p>

      <h2>Binding lifecycle</h2>
      <p>
        <code>memory.bind(buffer)</code> installs connectors. Reading a field before
        binding throws — use <code>memory.bound</code> and <code>memory.onBound(cb)</code>{' '}
        to sequence code that must wait (this is what makes SSR and lazy pool
        construction safe).
      </p>
    </article>
  );
}
