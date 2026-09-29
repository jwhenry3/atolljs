// Worker entry — spawned by the route's createWorker factory. The shim MUST
// be first: it binds self = parentPort before workerBootstrap wires
// INIT_MEMORY / EXECUTE_TASK onto the node:worker_threads MessagePort.
import '@atolljs/node/shim';
import '@atolljs/core/worker/workerBootstrap';
import { TaskRegistry } from '@atolljs/core';
import { createHash } from 'node:crypto';
import { digestMemory, HashDigest } from './digest.contract';

TaskRegistry.register(HashDigest, (input = 'incident-feed', rounds = 50_000) => {
  const t0 = performance.now();
  let digest = input;
  for (let i = 0; i < rounds; i++) {
    digest = createHash('sha256').update(digest).digest('hex');
  }
  const jobs = digestMemory.jobsDone.read() + 1;
  digestMemory.jobsDone.write(jobs);
  return { hash: digest.slice(0, 16), rounds, ms: performance.now() - t0, jobsDone: jobs };
});
