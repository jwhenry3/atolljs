import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

export function Reef() {
  return (
    <article>
      <h1>Reef schemas</h1>
      <p className="lead">
        <code>reef</code> is the fixed-width schema vocabulary — the structural
        barrier between your data and the raw buffer. Every helper mints a
        schema that is <em>both</em> the validator and the binary layout spec:
        one declaration, no second place for the layout to drift.
      </p>

      <CodeBlock
        file="row.schema.ts"
        code={`import { reef } from '@atolljs/core';

const incidentRow = reef.object({
  id:         reef.u32(),          // 4 bytes — uint32 domain
  severity:   reef.int(0, 3),      // 1 byte  — domain 0..3, narrowest covering kind
  alarms:     reef.u16(),          // 2 bytes
  open:       reef.boolean(),      // flag byte
  site:       reef.string(10),     // 10 inline UTF-8 bytes — budget IS the schema
  openedAt:   reef.u64(),          // 8-byte bigint
});

// The schema validates AND lays out — a million of these become a flat
// array of structs under field.list:
field.list({ schema: incidentRow, count: 1_000_000 });`}
      />

      <h2>The vocabulary</h2>
      <p>
        Only helpers whose schemas can promise a byte width exist — there is no{' '}
        <code>reef.number()</code> because an unbounded width can't compile to a
        fixed layout. Ten scalar kinds, one spelling each; the format-based
        kinds are tagged directly and bounded ints cover the rest.
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Helper</th><th>Storage</th><th>Domain</th></tr>
        </thead>
        <tbody>
          <tr><td><code>reef.i8()</code> · <code>reef.u8()</code></td><td>1 byte</td><td>−128..127 · 0..255</td></tr>
          <tr><td><code>reef.i16()</code> · <code>reef.u16()</code></td><td>2 bytes</td><td>−32768..32767 · 0..65535</td></tr>
          <tr><td><code>reef.i32()</code> · <code>reef.u32()</code></td><td>4 bytes</td><td>int32 · uint32</td></tr>
          <tr><td><code>reef.i64()</code> · <code>reef.u64()</code></td><td>8 bytes</td><td>int64 · uint64 (bigint)</td></tr>
          <tr><td><code>reef.f32()</code> · <code>reef.f64()</code></td><td>4 / 8 bytes</td><td>float</td></tr>
          <tr><td><code>reef.int(min, max)</code></td><td>narrowest covering kind</td><td><code>min..max</code></td></tr>
          <tr><td><code>reef.boolean()</code></td><td>flag byte</td><td>—</td></tr>
          <tr><td><code>reef.string(bytes)</code></td><td><code>bytes</code> inline UTF-8</td><td>byte length ≤ <code>bytes</code></td></tr>
          <tr><td><code>reef.object(shape)</code></td><td>fixed record — member widths summed + aligned</td><td>per member</td></tr>
          <tr><td><code>reef.array(el)</code></td><td>bounded via <code>.max(n)</code> / <code>.length(n)</code></td><td>per element</td></tr>
        </tbody>
      </table>
      <p>
        <code>reef.int(0, 3)</code> declares a <em>domain</em> — the compiler picks
        the narrowest covering width (u8 → i8 → u16 → i16 → u32 → i32). Writes
        of <code>9</code> still reject: bounds can be stricter than storage,
        never looser.
      </p>

      <h2>Where schemas plug in</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Field factory</th><th>Schema it takes</th><th>Layout it derives</th></tr>
        </thead>
        <tbody>
          <tr><td><code>field.list({'{ schema, count }'})</code></td><td><code>reef.object(...)</code></td><td>record array — <code>readAt(i)</code>/<code>writeAt(i)</code> are pointer arithmetic</td></tr>
          <tr><td><code>field.object({'{ schema }'})</code></td><td><code>reef.object(...)</code></td><td>one inline record — <code>byteLength</code> derived, no <code>maxBytes</code></td></tr>
          <tr><td><code>field.array({'{ schema }'})</code></td><td><code>reef.array(el).max(n)</code></td><td>count header + <code>n</code> inline elements</td></tr>
          <tr><td><code>field.string({'{ schema }'})</code></td><td><code>reef.string(n)</code></td><td>length header + <code>n</code> inline UTF-8 bytes</td></tr>
        </tbody>
      </table>

      <h2>Your own zod works too</h2>
      <p>
        Classic <code>zod</code> and <code>zod/mini</code> schemas are accepted
        anywhere reef schemas are — the compiler duck-types on the zod-style{' '}
        <code>_zod.def</code>, so <code>z.uint32()</code>,{' '}
        <code>z.number().int().min(0).max(3)</code>, and{' '}
        <code>z.string().meta({'{ bytes: n }'})</code> compile identically:
      </p>
      <CodeBlock
        code={`import { z } from 'zod';

reef.object({
  id:    z.uint32(),                          // classic format → 'u32'
  level: z.number().int().min(0).max(3),      // bounds → narrowest kind ('u8')
  tag:   z.string().meta({ bytes: 8 }),       // meta → 8 inline bytes
  ref:   reef.u16(),                          // reef members mix the other way too
});`}
      />
      <p>
        Reef schemas are minted by a vendored engine — no zod dependency
        ships, and the classic chain spellings stay attached:{' '}
        <code>.refine()</code>, <code>.meta()</code>,{' '}
        <code>.min()/.max()</code>, <code>.length()</code>, <code>.int()</code>
        all work, and the compiler reads the <em>final</em> schema. Two honest
        limits: they aren't <code>instanceof z.ZodType</code> (check{' '}
        <code>s._zod.def</code> + <code>.parse</code> instead), and they can't
        be members of a <em>real</em> <code>z.object</code>/<code>z.array</code>{' '}
        — zod dispatches member parsing through its own internals; when a wire
        schema needs a reef value, compose with{' '}
        <code>reef.object</code>/<code>reef.array</code>.
      </p>

      <h2>What the reef rejects</h2>
      <p>
        Compile fails loudly rather than guessing a width — unbounded strings
        (no <code>bytes</code> meta), unbounded arrays, nested objects inside a
        record, and types with no fixed encoding (<code>z.date()</code>,{' '}
        <code>z.enum()</code>, unions) all throw at{' '}
        <code>defineSharedMemory</code>/<code>field.*</code> declaration time.
        Dynamic payloads aren't banned — they go through the codec escape
        hatch: <code>field.object({'{ maxBytes }'})</code> encodes arbitrary
        JSON-shaped values with the contract's codec, schema optional.
      </p>
      <p>
        Bundle note: reef runs on a vendored schema engine — zod isn't an{' '}
        <code>@atolljs/core</code> dependency at all, and it's fully opt-in —
        no <code>reef</code>/<code>listSchema</code> import, no schema code in
        your bundle. See <a href={docHref('bundle-size')}>Bundle size &amp; load</a>{' '}
        and <a href={docHref('shared-memory')}>Shared memory</a>.
      </p>
    </article>
  );
}
