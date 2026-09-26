import { createEffect, createRoot } from 'solid-js';
import { WorkerPool, reactive, type Logger } from '../../sdk/index';
import { marketTasks } from './task.contracts';
import { marketMemory, type Quote } from './memory.contracts';

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMB = (bytes: number) => `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}MB`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// Deterministic ticker symbols: A..Z, AA..ZZ, AAA... (≤4 chars, fits 8 bytes)
function ticker(i: number): string {
  let s = '';
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = ((i / 26) | 0) - 1;
  } while (i >= 0);
  return s;
}

/**
 * Market-data gateway: a worker pool maintains a 10k-instrument quote cache
 * in shared memory, updated by a live tick feed doing in-place record writes.
 * The main thread screens the market on demand and reacts to published stats.
 */
export async function runMarketDemo(log: Logger = console.log) {
  const workerUrl = new URL('./market.worker.ts', import.meta.url);
  const pool = new WorkerPool({ workerUrl, sharedMemory: marketMemory, poolSize: 2, tasks: marketTasks });

  // Seed 10k instruments — one bulk pass of fixed-layout writes, then a commit
  const quotes = marketMemory.quotes;
  const N = quotes.recordCount;
  let t0 = performance.now();
  const seed = {} as Quote;
  for (let i = 0; i < N; i++) {
    const price = 10 + (i % 400) + (i % 7) * 0.37;
    seed.symbol = ticker(i);
    seed.open = price;
    seed.last = price;
    seed.bid = price * 0.9995;
    seed.ask = price * 1.0005;
    seed.volume = 0;
    seed.ticks = 0;
    quotes.writeAt(i, seed);
  }
  quotes.commit();
  let ms = performance.now() - t0;
  log(`seed               : ${fmtInt(N)} instruments (${fmtMB(quotes.byteLength)}) in ${ms.toFixed(1)}ms — ${fmtInt(N / (ms / 1000))} writes/sec`);

  // React to every stats publication the workers make
  const stats = reactive(marketMemory.stats);
  const stop = stats.observeRemote();
  let updates = -1; // subtract the effect's initial run
  const dispose = createRoot((d) => {
    createEffect(() => { stats.get(); updates++; });
    return d;
  });

  // Three sessions: feed bursts interleaved with screener queries and
  // breadth stats — the workload a market gateway actually sees.
  for (let round = 1; round <= 3; round++) {
    const TICKS = 500_000;
    ms = await pool.feedTicks(TICKS);
    log(`feed round ${round}      : ${fmtInt(TICKS)} ticks in ${ms.toFixed(1)}ms (${fmtInt(TICKS / (ms / 1000))} ticks/sec — random-access record updates)`);

    const tStats = performance.now();
    const s = await pool.publishStats();
    log(`breadth            : ${fmtInt(s.instruments)} instruments scanned in ${(performance.now() - tStats).toFixed(1)}ms — ${fmtInt(s.advancers)} adv / ${fmtInt(s.decliners)} dec, top mover ${s.topMover.symbol} ${fmtPct(s.topMover.changePct)}`);

    const tScreen = performance.now();
    const hits = await pool.screenQuotes(500_000, 5);
    log(`screener           : vol≥500k & |chg|≥5% → ${fmtInt(hits.length)} hits in ${(performance.now() - tScreen).toFixed(1)}ms`);
    for (const h of hits.slice(0, 5)) {
      log(`                     ${h.symbol.padEnd(6)} last $${h.last.toFixed(2).padStart(9)}  ${fmtPct(h.changePct).padStart(8)}  vol ${fmtInt(h.volume)}`);
    }
  }

  await new Promise((r) => setTimeout(r, 50));
  const observed = stats.peek();
  log(`reactive           : ${updates} stats publications observed live; latest shows ${fmtInt(observed.ticks)} total ticks`);
  log(`verify             : spot-check quote ${ticker(1234)} → ${JSON.stringify(quotes.readAt(1234, {}, ['symbol', 'last', 'volume']))}`);

  stop();
  dispose();
  pool.terminate();
}
