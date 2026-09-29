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
        code={`import { defineSharedMemory, field, mz } from '@atolljs/core/sdk';

// Fields may group by intent — lists / state / signals nest one level and
// every surface mirrors it: memory.signals.count, spec.signals.count, …
export const memory = defineSharedMemory({
  signals: {
    count:   field.number(),                   // f64 scalar
    running: field.boolean(),                  // flag byte
  },
  state: {
    label:   field.string({ schema: mz.string(128) }),        // budget derives from the schema
    metrics: field.object({ schema: metricsSchema }),         // mz.object → inline record, no maxBytes
    payload: field.object({ maxBytes: 2048 }),                // codec blob — the escape hatch for dynamic data
    samples: field.float64Array({ length: 1024 }),            // typed view, zero-copy
  },
  lists: {
    // mz members are zod schemas that ARE the layout: mz.u32() → 'u32',
    // mz.int(0, 3) → 'u8', mz.string(10) → 10 inline bytes
    records: field.list({ schema: mz.object({ id: mz.u32(), score: mz.f64(), tag: mz.string(8) }), count: 1_000_000 }),
  },
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
          <tr><td><code>field.string({'{ maxBytes }'})</code></td><td>4-byte length + payload</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.object({'{ maxBytes, schema? }'})</code></td><td>codec-encoded blob</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.array({'{ maxBytes, schema? }'})</code></td><td>codec-encoded blob</td><td><code>read() / write(v)</code></td></tr>
          <tr><td><code>field.int32Array({'{ length }'})</code> · <code>float64Array({'{ length }'})</code> · <code>bigInt64Array({'{ length }'})</code> · <code>uint8Array({'{ length }'})</code></td><td>n × element size</td><td>typed-array views — direct indexed access, zero copy</td></tr>
          <tr><td><code>field.list({'{ schema, count }'})</code></td><td>fixed-size records</td><td><code>readAt(i)</code>, <code>writeAt(i, rec)</code>, <code>commit()</code></td></tr>
        </tbody>
      </table>
      <p>
        List scalar kinds: <code>i8 u8 i16 u16 i32 u32 f32 f64 i64 u64</code> — or
        declare members as <code>mz</code>/zod schemas (<code>mz.u32()</code>,{' '}
        <code>mz.int(0, 3)</code> → narrowest covering kind,{' '}
        <code>mz.string(10)</code>) and the same declaration becomes both layout
        and validation schema.
        A field is accessed on the contract object —{' '}
        <code>memory.state.metrics.read()</code> — identical API on both threads,
        and observers address fields by path:{' '}
        <code>observe(memory, 'signals.count')</code>.
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
        code={`import { jsonCodec } from '@atolljs/core/sdk';

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

      <h2>Custom connectors &amp; manual allocation</h2>
      <p>
        A field kind is just a registered <code>ConnectorFactory</code>:{' '}
        <code>(descriptor, ctx, byteOffset) =&gt; Connector</code>. The context
        hands the factory the <code>SharedArrayBuffer</code>, the contract's
        codec, and the field's slot in the shared version counter; the returned
        connector's <code>read()</code>/<code>write(v)</code> own that region.{' '}
        <code>registerConnectorFactory(kind, factory)</code> registers a custom
        storage backend SDK-wide;{' '}
        <code>defineSharedMemory(spec, {'{ plugins: { kind: factory } }'})</code>{' '}
        overrides per contract.
      </p>
      <p>
        Underneath the pool sits <code>MemoryManager</code> — the allocator it
        wraps when <code>sharedMemory</code> is configured. It owns a shared{' '}
        <code>WebAssembly.Memory</code> (<code>initialPages</code> 16 = 1 MB,{' '}
        <code>maximumPages</code> 16384 = 1 GB by default), grows it via{' '}
        <code>ensureCapacity(bytes)</code>, and exposes the storage with{' '}
        <code>getView(type, byteOffset?, length?)</code> and{' '}
        <code>getBuffer()</code>. Reach for it directly only when you manage the
        buffer yourself — e.g. a SharedWorker host allocating once for all
        clients.
      </p>
    </article>
  );
}
