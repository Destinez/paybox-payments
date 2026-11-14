import { spawn } from 'node:child_process';

const children = ['server', 'worker'].map((name) =>
  spawn(process.execPath, [`apps/api/dist/${name}.js`], { stdio: 'inherit', env: process.env }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
