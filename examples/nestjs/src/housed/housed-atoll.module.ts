// Main-side boundary for the 'housed' pool — the registerPool half of the
// housed API (the controller/providers half lives in housed-api.module.ts,
// which only workers import).
//
// Unlike the incidents pool this one is MESSAGE-ONLY — no sharedMemory of
// its own. Its workers read the incidents pool's buffer instead, threaded
// in by withSharedBuffer (evaluated per spawn, so respawns get it too) and
// bound in housed.worker.ts. Two pools' workers, one shared buffer.
import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule, getAtollPool } from '@atolljs/nestjs';
import { withSharedBuffer } from '@atolljs/node';

@Module({
  imports: [
    AtollModule.registerPool({
      name: 'housed',
      worker: withSharedBuffer(
        () => new Worker(new URL('./housed.worker.js', import.meta.url)),
        // Resolved lazily — IncidentsAtollModule is imported first.
        () => getAtollPool('incidents')?.sharedBuffer,
      ),
      poolSize: 2,
    }),
  ],
})
export class HousedAtollModule {}
