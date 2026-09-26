import { TaskRegistry } from '../../sdk/worker/registry';
import { FeedTicks, PublishStats, ScreenQuotes } from './task.contracts';
import { QUOTE_HOT_FIELDS, marketMemory, type Quote, type ScreenHit } from './memory.contracts';
import '../../sdk/worker/workerBootstrap'; // Wires up message listeners

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32((Math.random() * 0xffffffff) | 0);

const rec = {} as Quote;

// Feed handler: each tick is a random-access read-modify-write on one quote
// record — the access pattern struct fields are built for. No serialization
// anywhere on the hot path; symbol/open are never touched.
TaskRegistry.register(FeedTicks, (ticks) => {
  const quotes = marketMemory.quotes;
  const start = performance.now();
  for (let n = 0; n < ticks; n++) {
    const i = (rand() * quotes.recordCount) | 0;
    quotes.readAt(i, rec, QUOTE_HOT_FIELDS);
    rec.last = Math.max(0.01, rec.last * (1 + (rand() - 0.5) * 0.004));
    rec.bid = rec.last * 0.9995;
    rec.ask = rec.last * 1.0005;
    rec.volume += 1 + ((rand() * 500) | 0);
    rec.ticks += 1;
    quotes.writeAt(i, rec, QUOTE_HOT_FIELDS);
  }
  quotes.commit(); // one version bump for the whole tick batch
  return performance.now() - start;
});

// Screener: full-market scan via field projection — symbol + the 3 fields
// the criteria need, nothing else.
TaskRegistry.register(ScreenQuotes, (minVolume, minChangePct) => {
  const quotes = marketMemory.quotes;
  const hits: ScreenHit[] = [];
  const fields: (keyof Quote)[] = ['symbol', 'last', 'open', 'volume'];
  for (let i = 0; i < quotes.recordCount; i++) {
    quotes.readAt(i, rec, fields);
    const changePct = ((rec.last - rec.open) / rec.open) * 100;
    if (rec.volume >= minVolume && Math.abs(changePct) >= minChangePct) {
      hits.push({ symbol: rec.symbol, last: rec.last, changePct, volume: rec.volume });
    }
  }
  hits.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return hits.slice(0, 50);
});

// Stats publisher: scans breadth over the cache and publishes a structured
// stats object — main thread observes this field reactively.
TaskRegistry.register(PublishStats, () => {
  const quotes = marketMemory.quotes;
  const fields: (keyof Quote)[] = ['symbol', 'last', 'open', 'volume', 'ticks'];
  let totalVolume = 0;
  let ticks = 0;
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  const topMover = { symbol: '', changePct: 0 };
  for (let i = 0; i < quotes.recordCount; i++) {
    quotes.readAt(i, rec, fields);
    ticks += rec.ticks;
    totalVolume += rec.volume;
    const changePct = ((rec.last - rec.open) / rec.open) * 100;
    if (changePct > 0.01) advancers++;
    else if (changePct < -0.01) decliners++;
    else unchanged++;
    if (Math.abs(changePct) > Math.abs(topMover.changePct)) {
      topMover.symbol = rec.symbol;
      topMover.changePct = changePct;
    }
  }
  const stats = {
    ticks,
    instruments: quotes.recordCount,
    totalVolume,
    advancers,
    decliners,
    unchanged,
    topMover,
    computedBy: 'worker',
  };
  marketMemory.stats.write(stats); // version bump → main thread reacts
  return stats;
});
