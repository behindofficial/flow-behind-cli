import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/ and dist/ both live directly under the package root.
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_INFO = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
export const BRAND = Object.freeze({
  name: 'Flow Behind CLI', company: 'Flow Behind',
  command: 'flow-behind', mcpCommand: 'flow-behind-mcp',
  package: PACKAGE_INFO.name, version: PACKAGE_INFO.version,
});
export const STATE_DIR = process.env.FLOW_BEHIND_HOME
  ? resolve(process.env.FLOW_BEHIND_HOME) : join(homedir(), '.flow-behind');
export const updatesDisabled = () => Boolean(
  process.env.FLOW_BEHIND_NO_UPDATE_CHECK || process.env.FLOW_AUTO_NO_UPDATE_CHECK
);
