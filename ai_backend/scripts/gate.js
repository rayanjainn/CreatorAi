// npm run gate -- N : lint, then every test in tests/phase0 ... tests/phaseN.
// Gates are cumulative, so phase N re-runs every earlier phase's tests.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n = Number(process.argv[2]);

if (!Number.isInteger(n) || n < 0 || n > 8) {
  console.error('usage: npm run gate -- <phase 0-8>');
  process.exit(2);
}

function step(label, args) {
  console.log(`\n== gate ${n}: ${label} ==`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\ngate ${n} FAILED at: ${label}`);
    process.exit(r.status || 1);
  }
}

const dirs = [];
for (let i = 0; i <= n; i++) {
  const dir = `tests/phase${i}`;
  if (!fs.existsSync(path.join(root, dir))) {
    console.error(`gate ${n}: ${dir} does not exist; every phase up to ${n} needs its tests.`);
    process.exit(1);
  }
  dirs.push(dir);
}

step('lint', [path.join(root, 'node_modules/eslint/bin/eslint.js'), '.', '--max-warnings=0']);
step(`tests (${dirs.join(', ')})`, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...dirs]);
console.log(`\ngate ${n} PASSED`);
