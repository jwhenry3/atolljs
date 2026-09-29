// Worker entry for the 'housed' pool — a dedicated HTTP worker, NOT a task
// worker (no runAtollWorker, no bootstrap): the pool is message-only, the
// incidents buffer arrives via withSharedBuffer (shared by reference with
// the incidents pool), contracts bind on it, then a full Nest app serves
// /api/housed/* entirely off the API thread.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { bindSharedBuffer } from '@atolljs/node';
import { serveHttp } from '@atolljs/node/http';
import { HousedApiModule } from './housed-api.module';

void (async () => {
  await bindSharedBuffer(); // the incidents pool's buffer — same memory, both pools
  const app = await NestFactory.create(HousedApiModule, { logger: ['warn', 'error'] });
  await app.init();
  serveHttp(app.getHttpServer(), { listen: 0 });
})();
