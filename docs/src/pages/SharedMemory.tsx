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
          <tr><td><code>field.string({'{ maxBytes }'})</code> · <code>field.string({'{ schema }'})</code></td><td><code>string</code></td><td>4-byte length + inline UTF-8 — budget derives from <code>mz.string(n)</code></td></tr>
          <tr><td><code>field.object({'{ schema }'})</code></td><td><code>T</code></td><td>inline fixed record — width derives from <code>mz.object(...)</code> members</td></tr>
          <tr><td><code>field.object({'{ maxBytes, schema? }'})</code></td><td><code>T</code></td><td>4-byte length + codec-encoded payload</td></tr>
          <tr><td><code>field.array({'{ schema }'})</code></td><td><code>T[]</code></td><td>count header + bounded inline elements — from <code>z.array(el).max(n)</code></td></tr>
          <tr><td><code>field.array({'{ maxBytes, schema? }'})</code></td><td><code>T[]</code></td><td>same, codec-encoded</td></tr>
          <tr><td><code>field.int32Array({'{ length }'})</code> / <code>float64Array({'{ length }'})</code> / <code>bigInt64Array({'{ length }'})</code> / <code>uint8Array({'{ length }'})</code></td><td>typed array</td><td>raw view — <code>read()</code> is zero-copy</td></tr>
          <tr><td><code>field.list({'{ schema, count }'})</code></td><td>record array</td><td>fixed-layout records — <code>schema</code> is an <code>mz.object</code> of fixed-width members (<code>mz.u32()</code>, <code>mz.string(10)</code>)</td></tr>
        </tbody>
      </table>

      <h2>Intent groups</h2>
      <p>
        Spec fields may nest one level under an intent group — the incidents
        contract uses <code>lists</code> (record arrays scanned in workers),{' '}
        <code>state</code> (codec-encoded snapshots), and <code>signals</code>{' '}
        (reactive scalars). The group is purely declarative: allocation is a
        flat layout underneath, and every surface mirrors the nesting —{' '}
        <code>memory.state.metrics</code>, <code>memory.spec.state.metrics</code>,{' '}
        <code>memory.schemas.state.metrics</code>, and observers addressed by path
        (<code>observe(memory, 'signals.seedProgress')</code>).
      </p>

      <h2>The <code>mz</code> datatype wrapper</h2>
      <p>
        Every shared-memory value is fixed-width — a <code>SharedArrayBuffer</code>{' '}
        cannot resize, so strings and encoded objects declare byte budgets and
        list members compile to scalar widths. <code>mz</code> is the curated
        fixed-width vocabulary — only helpers whose schemas derive a byte
        width exist:{' '}
        <code>mz.u8()</code>–<code>mz.u64()</code>, <code>mz.f32()</code>/{' '}
        <code>mz.f64()</code>, <code>mz.int(min, max)</code> (bounds pick the
        narrowest covering kind), <code>mz.boolean()</code> (flag byte),{' '}
        <code>mz.string(bytes)</code> (inline capacity), and the{' '}
        <code>mz.object</code>/<code>mz.array</code> composers. Each is a real
        zod schema — layout and validation come from the same declaration.
      </p>
      <p>
        Fixed width composes upward: <code>field.object({'{ schema }'})</code>{' '}
        with an <code>mz.object</code> stores one inline record (byteLength is
        derived — there is no <code>maxBytes</code> to guess),{' '}
        <code>field.array({'{ schema }'})</code> with a bounded{' '}
        <code>z.array(el).max(n)</code> stores a count + inline elements, and{' '}
        <code>field.string({'{ schema }'})</code> reads its budget from{' '}
        <code>mz.string(n)</code>. <code>maxBytes</code> remains the escape
        hatch for payloads no fixed width can describe — its presence selects
        the codec path.
      </p>

      <h2>Connectors</h2>
      <p>
        Every field exposes a <code>Connector&lt;T&gt;</code>: <code>read()</code> /{' '}
        <code>write(v)</code>, plus a shared <em>version counter</em> bumped by{' '}
        <code>Atomics</code> on each write. That's how the other thread observes
        changes without messages.
      </p>
      <p>
        List fields return a <code>ListConnector&lt;R&gt;</code> with record-level
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
        or <code>jsonCodec</code>. Optional zod schemas (<code>listSchema</code>,
        object/array <code>schema</code> options) validate values at the boundary.
        Every field also surfaces its schema on <code>memory.schemas.&lt;name&gt;</code>{' '}
        and its descriptor on <code>memory.spec.&lt;name&gt;</code> — list members
        may be zod schemas directly (<code>z.uint32()</code>, bounded{' '}
        <code>z.int().min().max()</code>, <code>z.string().meta({'{ bytes: n }'})</code>),
        which compile to the same layout while carrying their own validation.
        Register custom field kinds globally with{' '}
        <code>registerConnectorFactory(kind, factory)</code> or per contract via{' '}
        <code>SharedMemoryOptions.plugins</code>.
      </p>

      <h2>Custom connectors &amp; the allocator</h2>
      <p>
        A field kind is just a registered <code>ConnectorFactory</code> —{' '}
        <code>(descriptor: FieldDescriptor, ctx: ConnectorContext, byteOffset)
        =&gt; Connector</code> (<code>src/sdk/contract/sharedMemory.ts</code>).
        The context hands the factory the <code>SharedArrayBuffer</code>, the
        contract's codec, and the field's slot in the shared version counter;
        the returned connector's <code>read()</code>/<code>write(v)</code> own
        that region. <code>registerConnectorFactory(kind, factory)</code>{' '}
        registers a custom storage backend SDK-wide;{' '}
        <code>plugins</code> overrides per contract.
      </p>
      <p>
        Underneath the pool sits <code>MemoryManager</code> (
        <code>src/sdk/pool/memory.ts</code>) — the allocator it wraps when{' '}
        <code>sharedMemory</code> is configured. It owns a shared{' '}
        <code>WebAssembly.Memory</code> (<code>initialPages</code> 16 = 1 MB,{' '}
        <code>maximumPages</code> 16384 = 1 GB by default), grows it via{' '}
        <code>ensureCapacity(bytes)</code>, and exposes storage through{' '}
        <code>getView(type, byteOffset?, length?)</code> and{' '}
        <code>getBuffer()</code>. Both the <code>WorkerPool</code> and the
        SharedWorker host use it; you only need it directly when managing
        buffers yourself.
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
