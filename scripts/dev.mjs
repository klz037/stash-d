import { spawn } from 'node:child_process';

const npmCommand = process.env.npm_execpath ?? 'npm';
console.log('stash\'d development servers');
console.log('  Web: http://localhost:5173');
console.log('  API: http://127.0.0.1:3000/api/health');
console.log('');

const processes = [
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