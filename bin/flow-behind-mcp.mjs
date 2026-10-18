#!/usr/bin/env node
process.env.CONNECTOR_BIN = 'flow-behind-mcp';
await import('../dist/mcp.js');
