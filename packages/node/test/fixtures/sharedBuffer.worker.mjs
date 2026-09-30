/**
 * Real node:worker_threads fixture for bindSharedBuffer: defines a contract,
 * waits for the shared buffer — via `workerData.buffer` or the SHARED_BUFFER
 * message `withSharedBuffer` posts — then writes through the bound connector
 * so the main thread can read the field through its own copy of the contract
 * (proof the same bytes back both threads).
 *
 * Must be spawned with `--import ./aliasCore.mjs` (execArgv) so '@atolljs/core'
 * resolves — see that file's comment.
 *
 * workerData knobs: { buffer } binds via the workerData path; { timeout }
 * shortens the no-buffer wait so timeout tests stay fast.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { defineSharedMemory, field } from '@atolljs/core';
import { bindSharedBuffer } from '../../src/sharedBuffer.ts';

const memory = defineSharedMemory({
  probe: field.number(),
  label: field.string({ maxBytes: 64 }),
});

const timeout = workerData?.timeout ?? 5_000;

bindSharedBuffer(timeout)
  .then(() => {
    // Contract is bound — write fields the main thread will read back.
    memory.probe.write(1337);
    memory.label.write('bound-in-worker');
    parentPort.postMessage({ type: 'BOUND' });
  })
  .catch((err) => {
    parentPort.postMessage({ type: 'BIND_FAILED', error: err?.message ?? String(err) });
  });
