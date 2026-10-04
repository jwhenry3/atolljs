import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const ISLAND = `// src/app/dashboard/ChartsIsland.tsx: a client component is the boundary
'use client';

import { Island } from '@atolljs/react-island';
import type { ChartsApp } from './charts.worker'; // type only!

const renderWorker = () =>
  new Worker(new URL('./charts.worker.ts', import.meta.url), { type: 'module' });

export function ChartsIsland() {
  return (
    <Island
      worker={renderWorker}
      app="charts"                 // registry name, or the component for props inference
      props={{ width: 520 }}
      onEvent={(name, payload) => console.log('island event', name, payload)}
      slots={{ toolbar: <ToolbarButton /> }} // main-thread React into worker slots
    />
  );
}`;

const WORKER = `// src/app/dashboard/charts.worker.ts: the worker entry + what goes inside
import { useEffect, useState } from 'react';
import { defineReactPolyWorker } from '@atolljs/react-island/worker';
import { emit } from '@atolljs/islands/worker';

// Ordinary React: hooks, state, effects all run in the worker. No DOM
// access, serializable props, emit() is the island → shell channel.
export function ChartsApp({ width = 480 }: { width?: number }) {
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => {
    const id = setInterval(() =>
      setPoints((p) => [...p.slice(-59), Math.random() * 100]), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="chart" style={{ width }}>
      <h3>live series: {points.length} pts</h3>
      <button onClick={() => emit('reset', { at: Date.now() })}>reset</button>
    </div>
  );
}

export const chartsWorker = defineReactPolyWorker({
  apps: { charts: ChartsApp },
});`;

const PAGE = `// src/app/dashboard/page.tsx: a plain server component composes it
import { ChartsIsland } from './ChartsIsland';

export default function Page() {
  return (
    <main>
      <h1>Operations</h1>          {/* server-rendered, streamed instantly */}
      <ChartsIsland />             {/* renders in a worker, hydrates async */}
    </main>
  );
}`;

export function NextjsIslands() {
  return (
    <article>
      <h1>Next.js, worker islands</h1>
      <p className="lead">
        <code>@atolljs/react-island</code>&apos;s <code>&lt;Island&gt;</code> is
        an ordinary React component, inside <code>&apos;use client&apos;</code>{' '}
        it mounts a <em>worker-hosted React tree</em> into an App Router
        page. Reconciliation, rendering, and that subtree&apos;s state churn
        run off the main thread; Next keeps the shell, routing, and
        streaming.
      </p>

      <h2>The boundary</h2>
      <CodeBlock code={ISLAND} file="ChartsIsland.tsx" />
      <CodeBlock code={PAGE} file="page.tsx" />
      <p>
        SSR is honest: the server renders the empty container div, and the
        worker + first op batch mount in an effect after hydration. The
        island&apos;s content isn&apos;t in the server HTML: same trade-off as
        any client-side render, scoped to the island instead of the page.
      </p>

      <h2>What runs where</h2>
      <CodeBlock code={WORKER} file="charts.worker.ts" />
      <p>
        The worker entry, <code>definePolyWorker</code>/<code>islandApp</code>{' '}
        plus a proxy-DOM document, owns the React reconciler; ops stream to
        the main thread which applies them to real DOM. Props and events
        cross as structured clones; large data belongs in shared memory.{' '}
        <code>slots</code> are the escape hatch back to the main thread:
        portals into <code>data-atoll-slot</code> anchors for things workers
        can&apos;t do (canvas libraries, maps, Monaco, third-party widgets).
        Full contract: <a href={docHref('islands')}>Islands</a> and{' '}
        <a href={docHref('fw-react/worker-islands')}>React → Islands</a>.
      </p>

      <h2>Why it matters under Next.js</h2>
      <p>
        App Router already thinks in islands (server components + client
        boundaries): worker islands push that further: a 50k-row virtual
        table or a streaming chart can re-render at full tilt without a
        single main-thread commit. The page&apos;s interactivity budget stays
        flat no matter how hot the subtree runs.
      </p>
      <p>
        Deployment note: this is a <em>browser</em> worker: it works in
        static export too (<code>output: &apos;export&apos;</code>), needing
        only COOP/COEP headers if it uses shared memory. Nothing here
        requires the Node runtime, unlike the server-side pages in this
        section.
      </p>
    </article>
  );
}
