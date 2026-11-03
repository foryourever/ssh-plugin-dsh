#!/usr/bin/env node
// Explicit backend setup only: node scripts/setup-backend.mjs [--build].
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
}
try {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/setup-backend.mjs [--build | --platform <os-arch> --workers <1-32>]\nDefault: download the pinned official backend and verify SHA256.\n--build: requires Cargo; builds original/backend with --locked into bin/.');
  } else if (args.includes('--build')) {
    if (args.length !== 1) throw new Error('--build cannot be combined with download options');
    // Keep original/ read-only, including its target directory.
    const target = join(root, 'bin', '.cargo-target');
    run('cargo', ['build', '--locked', '--release', '--manifest-path', join(root, 'original', 'backend', 'Cargo.toml'), '--target-dir', target]);
    const executable = process.platform === 'win32' ? 'dbx-plugin-ssh.exe' : 'dbx-plugin-ssh';
    mkdirSync(join(root, 'bin'), { recursive: true });
    copyFileSync(join(target, 'release', executable), join(root, 'bin', executable));
    chmodSync(join(root, 'bin', executable), 0o755);
    console.log(`Built backend: bin/${executable}`);
  } else {
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    run(python, [join(root, 'scripts', 'backend-download.py'), ...args]);
  }
} catch (error) {
  console.error(`Backend setup failed: ${error.message}`);
  process.exitCode = 1;
}
