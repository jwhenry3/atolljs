// Kills whatever is listening on the documented app ports — for when dev
// servers get orphaned (e.g. an orchestrator was force-killed and its
// children survived). Usage: node scripts/kill-all.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { apps } from './apps.mjs';

const windows = process.platform === 'win32';

// Returns the set of PIDs listening on the given ports.
function listenersByPort(ports) {
  const pids = new Map(); // pid -> Set<port>
  const add = (pid, port) => {
    if (!pids.has(pid)) pids.set(pid, new Set());
    pids.get(pid).add(port);
  };

  if (windows) {
    // netstat -ano: proto  local  foreign  state  pid
    // NOTE: no -p flag — `-p tcp` on Windows lists IPv4 TCP only, hiding
    // [::1]:port listeners. Plain -ano covers both families; the LISTENING
    // filter excludes UDP rows (they carry no state).
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      const pid = Number(cols.at(-1));
      for (const port of ports) {
        if (local.endsWith(`:${port}`)) add(pid, port);
      }
    }
  } else {
    for (const port of ports) {
      try {
        const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
          encoding: 'utf8',
        });
        for (const pid of out.trim().split('\n')) {
          if (pid) add(Number(pid), port);
        }
      } catch {
        // lsof exits non-zero when nothing listens on the port.
      }
    }
  }
  return pids;
}

const pids = listenersByPort(apps.map(([, , port]) => port));

if (pids.size === 0) {
  console.log('all app ports are free');
  process.exit(0);
}

for (const [pid, ports] of pids) {
  const label = [...ports].map((p) => `:${p}`).join(', ');
  const result = windows
    ? spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'inherit' })
    : spawnSync('kill', ['-9', String(pid)], { stdio: 'inherit' });
  console.log(
    result.status === 0
      ? `killed pid ${pid} (${label})`
      : `failed to kill pid ${pid} (${label})`
  );
}
