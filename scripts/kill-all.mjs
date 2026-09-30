// Kills whatever is listening on the documented app ports — for when dev
// servers get orphaned (e.g. an orchestrator was force-killed and its
// children survived). Usage: node scripts/kill-all.mjs
import { apps } from './apps.mjs';
import { killStaleServers } from './orchestrate.mjs';

const ports = apps.map(([, , port]) => port);
if (killStaleServers(ports)) {
  console.log('all app ports are free');
}
