import { spawn, spawnSync } from 'node:child_process';

const npmCommand = process.env.npm_execpath ?? 'npm';
console.log("stash'd development servers");
console.log('  Web: http://localhost:5173');
console.log('  API: http://127.0.0.1:3000/api/health');
console.log('');

// The API compiles against packages/shared/dist, not src. Every "has no
// exported member" error we've hit today was a stale dist after someone
// edited shared. So: build it once before anything starts, then keep a
// watcher on it for the rest of the session.
console.log('[shared] building once…');
const first = spawnSync(npmCommand, ['run', 'build', '-w', '@stashd/shared'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});
if (first.status !== 0) {
  console.error('[shared] build failed. Fix packages/shared first; nothing else can compile without it.');
  process.exit(first.status ?? 1);
}

const processes = [
  ['shared', ['run', 'build', '-w', '@stashd/shared', '--', '--watch', '--preserveWatchOutput']],
  ['api', ['run', 'start:dev', '-w', '@stashd/api']],
  ['web', ['run', 'dev', '-w', '@stashd/web']],
].map(([name, args]) => {
  const child = spawn(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[${name}] exited with ${signal}`);
    } else if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
});

function stopChildren() {
  for (const child of processes) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', stopChildren);
process.on('SIGTERM', stopChildren);
