import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getAtollPool } from '@atolljs/nestjs';
import {
  proxyToWorker,
  createHttpCluster,
  workerHttpPorts,
} from '@atolljs/node/http';
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

// Clustering (Node ≥ 26): a second listener where the main thread never
// parses HTTP — each accepted socket is handed to a housed worker unparsed.
// Clustering is per-connection, so it can't share :port with the app's own
// routes — the dedicated listener gives the housed API a zero-parse path.
// The workers' serveHttp already accepts HTTP_CONNECTION sockets alongside
// its internal port, so housed.worker.ts needs no change. Below Node 26
// createHttpCluster returns null after a notice — no capability check here.
const log = new Logger('Bootstrap');
if (pool) {
  const transferPort = Number(process.env.TRANSFER_PORT ?? port + 1);
  createHttpCluster({
    pool,
    port: transferPort,
    onListen: () =>
      log.log(`housed api (clustered) → http://localhost:${transferPort}/api/housed/incidents/whoami`),
  });
}
log.log(`atoll incidents api → http://localhost:${port}/api/incidents/stats`);
log.log(`housed api (proxied) → http://localhost:${port}/api/housed/incidents/whoami`);
