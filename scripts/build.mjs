import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/cli.js', 'src/mcp.js'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node\n// Flow Behind CLI — built from the editable src/ modules.' },
});
console.log('Built Flow Behind CLI and MCP server.');
