import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getAtollPool } from '@atolljs/nestjs';
import { proxyToWorker, workerHttpPorts } from '@atolljs/node/http';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();

// House part of the API inside the dedicated 'housed' pool: /api/housed/*
// proxies to a Nest app that exists ONLY inside those workers — its
// controllers and DI execute off-thread, and each response stamps the
// owning threadId. Everything else stays on this app's own routing.
const pool = getAtollPool('housed');
if (pool) {
  const tracker = workerHttpPorts(pool);
  let cursor = 0;
  app.use(
    '/api/housed',
    proxyToWorker({
      pool,
      tracker,
      to: '/api/housed', // express stripped the mount — restore it for the worker's routes
      worker: (workers) => workers[cursor++ % workers.length],
    }),
  );
}

const port = Number(process.env.PORT ?? 3100);
await app.listen(port);
const log = new Logger('Bootstrap');
log.log(`atoll incidents api → http://localhost:${port}/api/incidents/stats`);
log.log(`housed api (in-worker) → http://localhost:${port}/api/housed/incidents/whoami`);
