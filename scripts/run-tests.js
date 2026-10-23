// Minimal, dependency-free test runner: compiles the pure Home logic (lib/homeFeed,
// lib/refreshController, lib/locationTree) and tests/*.test.ts with the repo's own
// TypeScript, then runs them with Node's built-in test runner.
//   npm test
/* global __dirname */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');
fs.rmSync(out, { recursive: true, force: true });

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const files = fs.readdirSync(path.join(out, 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => path.join(out, 'tests', f));
const run = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
