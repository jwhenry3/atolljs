# Discord: NestJS Services That Run in Worker Threads

NestJS-focused post adapted from [`../blog/nestjs-di.md`](../blog/nestjs-di.md).
Copy the block between the rules verbatim: Discord renders markdown, so the
code fence and bold carry the formatting. Short enough for a server post.

---

**Ever had a service so heavy it slows down everything else?**

Moving it to a worker thread usually means giving up what makes Nest nice: no dependency injection, a pile of setup code, and your data getting copied back and forth on every call.

`@atolljs/nestjs` fixes that. Your service stays a normal injectable:

```ts
@Injectable()
@AtollService({ pool: 'reports' })
export class ReportService {
  constructor(@Inject(ScanTelemetry) private telemetry: ScanTelemetry) {}
}
```

Other services inject it like always and can't tell it runs on a worker thread. Inside the worker, Nest boots up too — so injected dependencies like `telemetry` are the real thing, not a stand-in.

You also get:
- `@AtollTask` to send just one method to a worker instead of the whole class
- Pools that share one chunk of memory instead of copying big datasets around
- Workers that can answer real HTTP routes, and pick their routes back up if they restart

Works with Nest 11 and 12.

`npm i @atolljs/nestjs` — docs + runnable example: https://jwhenry3.github.io/atolljs/

---
