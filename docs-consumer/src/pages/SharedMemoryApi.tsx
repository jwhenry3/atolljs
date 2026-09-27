import { CodeBlock } from '../components/CodeBlock';

export function SharedMemoryApi() {
  return (
    <article>
      <h1>Shared memory</h1>
      <p className="lead">
        <code>defineSharedMemory</code> declares a fixed byte layout once; both
        threads get identical connectors over the same{' '}
        <code>SharedArrayBuffer</code>.
      </p>

      <CodeBlock
        file="memory.contract.ts"
        code={`import { defineSharedMemory, field } from '@jwhenry123/mesh/sdk';

export const memory = defineSharedMemory({
  count:    field.number(),                    // f64 scalar
  running:  field.boolean(),                   // flag byte
  label:    field.string({ maxBytes: 128 }),                 // UTF-8, ≤128 bytes payload
  metrics:  field.object({ maxBytes: 2048, schema: metricsSchema }), // codec-encoded + optional zod schema
  samples:  field.float64Array({ length: 1024 }),          // typed view, zero-copy
  records:  field.struct({ id: 'u32', score: 'f64' }, 1_000_000),
});`}
      />

      <h2>Field kinds</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Factory</th><th>Layout</th><th>Connector API</th></tr>
        </thead>
        <tbody>
          <tr><td><code>field.number()</code></td><td>8 bytes (f64)</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.boolean()</code></td><td>8 bytes</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.string({ maxBytes: maxBytes })</code></td><td>4-byte length + payload</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.object(maxBytes, schema?)</code></td><td>codec-encoded blob</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.array(maxBytes, schema?)</code></td><td>codec-encoded blob</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.int32Array({ length: n })</code> · <code>float64Array(n)</code> · <code>bigInt64Array(n)</code> · <code>uint8Array(n)</code></td><td>n × element size</td><td>typed-array views — direct indexed access, zero copy</td></tr>
          <tr><td><code>field.struct(fields, count)</code></td><td>fixed-size records</td><td><code>readAt(i)</code>, <code>writeAt(i, rec)</code>, <code>commit()</code></td></tr>
        </tbody>
      </table>
      <p>
        Struct scalar kinds: <code>i8 u8 i16 u16 i32 u32 f32 f64 i64 u64</code>.
        A field is accessed on the contract object —{' '}
        <code>memory.metrics.read()</code> — identical API on both threads.
      </p>

      <h2>Codecs</h2>
      <p>
        Structured fields (<code>object</code>, <code>array</code>,{' '}
        <code>string</code>) encode through the contract's codec. The default is{' '}
        <code>msgpackrCodec</code> — MessagePack with structure sharing, the
        fastest option for uniform records. Alternatives:{' '}
        <code>msgpackCodec</code>, <code>jsonCodec</code>, or any{' '}
        <code>{'{ encode, decode }'}</code> object:
      </p>
      <CodeBlock
        code={`import { jsonCodec } from '@jwhenry123/mesh/sdk';

defineSharedMemory(spec, { codec: jsonCodec });  // opt out of the default`}
      />

      <h2>Binding lifecycle</h2>
      <p>
        <code>WorkerPool</code> binds the contract on the main thread and ships
        the buffer to workers in <code>INIT_MEMORY</code>. Reads before bind
        throw — <code>memory.bound</code> / <code>memory.onBound(cb)</code> tell
        you when it's safe. The <code>observe()</code>-based bindings handle
        this automatically: values stay <code>undefined</code> until bound, so
        SSR and early renders are safe.
      </p>

      <h2>Capacity</h2>
      <p>
        The pool sizes the shared buffer from the contract —{' '}
        <code>memory.totalBytes</code>. Configure growth via{' '}
        <code>WorkerPoolConfig.memory</code> (<code>maximumPages</code>,{' '}
        <code>growthFactor</code>).
      </p>
    </article>
  );
}
