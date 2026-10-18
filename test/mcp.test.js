import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root, isolatedHome } from './helpers.js';
import { join } from 'node:path';

test('MCP handshake exposes the same four tools and all original input fields',async () => {
  const transport=new StdioClientTransport({
    command:process.execPath,args:[join(root,'bin/flow-behind-mcp.mjs')],
    env:{...process.env,FLOW_BEHIND_HOME:isolatedHome(),FLOW_BEHIND_NO_UPDATE_CHECK:'1'},stderr:'pipe',
  });
  const client=new Client({name:'parity-test',version:'1.0.0'});
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion().name,'flow-behind');
    assert.equal(client.getServerVersion().version,'1.0.0');
    const {tools}=await client.listTools();
    assert.deepEqual(tools.map(t=>t.name),['flow_generate','flow_status','flow_list_jobs','flow_get_job']);
    const properties=tools[0].inputSchema.properties;
    assert.deepEqual(Object.keys(properties),['mode','prompt','image_paths','aspect_ratio','duration','image_model','outputs','folder']);
    assert.equal(properties.mode.enum.length,11);
    assert.equal(properties.folder.default,'flow-behind');
    assert.ok(properties.mode.enum.includes('flow-upload-assets'));
    assert.ok(properties.mode.enum.includes('flow-create-character'));
    const bad=await client.callTool({name:'flow_generate',arguments:{mode:'flow-text-to-image',prompt:'test',outputs:5}});
    assert.match(bad.content[0].text,/at most 4 outputs/);
  } finally { await client.close(); }
});

test('direct MCP entry retains the legacy Grok connector mode',async()=>{
  const transport=new StdioClientTransport({
    command:process.execPath,args:[join(root,'dist/mcp.js')],
    env:{...process.env,CONNECTOR_BIN:'grok-auto-mcp',FLOW_BEHIND_NO_UPDATE_CHECK:'1'},stderr:'pipe',
  });
  const client=new Client({name:'legacy-test',version:'1.0.0'});
  try {
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.deepEqual(tools.map(t=>t.name),['grok_generate','grok_status','grok_list_jobs','grok_get_job']);
    assert.equal(tools[0].inputSchema.properties.mode.enum.length,16);
  } finally { await client.close(); }
});
