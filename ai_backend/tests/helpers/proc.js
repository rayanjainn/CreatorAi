import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Runs a Node script from the repo root with the given env overrides (a value of
// undefined removes the variable). .env is never loaded in the child.
export function runNode(script, { args = [], env = {}, timeoutMs = 30_000 } = {}) {
  const childEnv = { ...process.env, SKIP_DOTENV: '1' };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: childEnv, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${script} timed out after ${timeoutMs} ms\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}
