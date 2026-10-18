import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const isolatedHome = () => mkdtempSync(join(tmpdir(), 'flow-behind-test-'));
export function runCli(args, { entry = 'bin/flow-behind.mjs', home = isolatedHome(), input = '', env = {} } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve(root, entry), ...args], {
      cwd: root, windowsHide: true,
      env: { ...process.env, FLOW_BEHIND_HOME: home, FLOW_BEHIND_NO_UPDATE_CHECK: '1', FLOW_AUTO_NO_UPDATE_CHECK: '1', ...env },
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timeout: ${args.join(' ')}`)); }, 15_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); resolveResult({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}
