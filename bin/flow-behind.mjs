#!/usr/bin/env node
process.env.CONNECTOR_BIN = 'flow-behind';
await import('../dist/cli.js');
