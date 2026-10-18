import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { root, isolatedHome, runCli } from './helpers.js';
import { JobParamsSchema } from '../src/shared/job.js';

const pause = ms => new Promise(r => setTimeout(r,ms));
async function eventually(check) {
  for (let i=0;i<100;i++) { const value = await check(); if(value) return value; await pause(30); }
  throw new Error('timed out waiting for bridge');
}
test('HTTP bridge and extension protocol preserve the complete job lifecycle', async t => {
  const home = isolatedHome();
  const socket = createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening');
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function launch() {
    child = spawn(process.execPath,['bin/flow-behind.mjs','--port',String(port),'bridge','start'],{
      cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,FLOW_BEHIND_HOME:home,FLOW_BEHIND_NO_UPDATE_CHECK:'1'},
    });
    await eventually(async () => {try {return (await fetch(base+'/status')).ok;} catch {return false;}});
  }
  async function halt() {
    const exited = once(child,'exit'); child.kill(); await exited;
  }
  await launch();
  let ws;
  t.after(async () => { ws?.terminate(); if(child.exitCode === null) await halt(); });
  async function request(path, body) {
    const response = await fetch(base+path,body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {code:response.status,body:await response.json()};
  }
  const spec = (mode='flow-text-to-image') => ({mode,prompt:'Test prompt',params:JobParamsSchema.parse({}),inputImages:[]});
  let id;
  const incoming = [];
  await t.test('queue without an extension, then dispatch on hello',async () => {
    const submit = await request('/jobs',{job:spec()});
    assert.equal(submit.code,200); id=submit.body.jobId;
    assert.equal((await request(`/jobs/${id}`)).body.status,'waiting_for_extension');
    ws = new WebSocket(base.replace('http:','ws:')+'/ws');
    ws.on('message', raw => {
      const msg=JSON.parse(raw); incoming.push(msg);
      if(msg.t==='logs.query') ws.send(JSON.stringify({t:'logs.result',entries:[{ts:1,level:'info',scope:'test',message:'ready'}]}));
      if(msg.t==='dom.query') ws.send(JSON.stringify({t:'dom.result',items:[{text:'Create'}]}));
      if(msg.t==='healthcheck.run') ws.send(JSON.stringify({t:'healthcheck.result',entries:[{key:'composer',matched:true}],diagnostics:{ready:true}}));
    });
    await once(ws,'open');
    ws.send(JSON.stringify({t:'ext.hello',extVersion:'1.2.4',loggedIn:true,plan:'pro',site:'flow',browser:'chrome',runningJobIds:[]}));
    const msg=await eventually(()=>incoming.find(m=>m.t==='job.submit' && m.jobId===id));
    assert.equal(msg.job.prompt,'Test prompt');
    assert.deepEqual(msg.inputFiles,[]);
  });
  await t.test('status metadata, diagnostics, logs and DOM round-trip', async () => {
    ws.send(JSON.stringify({t:'ext.status',loggedIn:true,plan:'pro',usedToday:2,dailyLimit:999,activeJobs:1,grokVisible:true,flowLayout:'wide',flowAccess:'ok',usage:{video:1,image:1},limits:{video:30,image:40}}));
    await eventually(async()=> (await request('/status?site=flow')).body.activeJobs===1);
    const status=(await request('/status?site=flow')).body;
    assert.equal(status.bridgeProduct,'flow-behind-cli'); assert.equal(status.flowLayout,'wide');
    assert.equal((await request('/logs?site=flow')).body.entries[0].message,'ready');
    assert.equal((await request('/dom?site=flow&selector=button')).body.items[0].text,'Create');
    assert.equal((await request('/healthcheck?site=flow')).body.diagnostics.ready,true);
  });
  await t.test('progress, long polling, result paths and warnings', async () => {
    ws.send(JSON.stringify({t:'job.accepted',jobId:id}));
    ws.send(JSON.stringify({t:'job.progress',jobId:id,stage:'generating'}));
    await eventually(async()=> (await request(`/jobs/${id}`)).body.stage==='generating');
    const waiting=request(`/jobs/${id}/wait?timeoutMs=2000`);
    ws.send(JSON.stringify({t:'job.result',jobId:id,files:[{kind:'image',path:'Downloads/test.png'}],warning:'partial result'}));
    const done=(await waiting).body;
    assert.equal(done.status,'done'); assert.equal(done.files[0].path,'Downloads/test.png'); assert.equal(done.error,'partial result');
  });
  await t.test('file registration, token download and input limits',async () => {
    const path=join(home,'reference.png'); writeFileSync(path,Buffer.from([1,2,3]));
    const submitted=await request('/jobs',{job:spec('flow-image-to-image'),imagePaths:[path]});
    assert.equal(submitted.code,200);
    const msg=await eventually(()=>incoming.find(m=>m.jobId===submitted.body.jobId));
    const token=msg.inputFiles[0].token;
    assert.deepEqual(Buffer.from(await (await fetch(base+'/files/'+token)).arrayBuffer()),Buffer.from([1,2,3]));
    assert.equal((await request('/jobs',{job:spec(),imagePaths:[path]})).code,400);
    assert.equal((await request('/jobs',{job:{...spec(),mode:'not-a-mode'}})).code,400);
    const many=spec('flow-ingredients-to-video'); many.params.imageModel='omni-flash';
    assert.equal((await request('/jobs',{job:many,imagePaths:Array(7).fill(path)})).code,200);
    assert.equal((await request('/jobs',{job:many,imagePaths:Array(8).fill(path)})).code,400);
  });
  await t.test('cancel survives late extension messages; stop and clear work',async () => {
    const job=(await request('/jobs',{job:spec()})).body.jobId;
    await request(`/jobs/${job}/cancel`,{});
    for (const msg of [{t:'job.accepted'},{t:'job.progress',stage:'generating'},{t:'job.result',files:[]},{t:'job.failed',reason:'late',retryable:true}]) ws.send(JSON.stringify({...msg,jobId:job}));
    await pause(60);
    assert.equal((await request(`/jobs/${job}`)).body.status,'cancelled');
    assert.equal((await request('/stop?site=flow',{})).body.delivered,true);
    assert.equal((await request('/reload-extension?site=flow',{})).body.delivered,true);
    const clear=(await request('/queue/clear?site=flow',{})).body;
    assert.ok(clear.removed>=3);
    assert.equal((await request('/jobs')).body.jobs.length,0);
  });
  await t.test('loopback host and browser-origin checks reject unrelated sites',async () => {
    assert.equal((await fetch(base+'/status',{headers:{Origin:'https://example.com'}})).status,403);
    const hostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(base+'/status', {headers:{Host:'example.com'}}, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on('error',reject); req.end();
    });
    assert.equal(hostStatus,403);
    assert.equal((await fetch(base+'/status',{headers:{Origin:'chrome-extension://test'}})).status,200);
  });
  await t.test('CLI targets a custom bridge port and records/resumes named runs',async () => {
    const args=['--port',String(port),'generate','create','flow-text-to-image','--prompt','Run item','--folder','demo','--index','1','--json'];
    const r=await runCli(args,{home}); assert.equal(r.code,0,r.stderr);
    const job=JSON.parse(r.stdout).jobId;
    ws.send(JSON.stringify({t:'job.failed',jobId:job,reason:'test failure',retryable:true}));
    await eventually(async()=> (await request(`/jobs/${job}`)).body.status==='failed');
    const dry=await runCli(['--port',String(port),'generate','resume','demo','--dry-run','--json'],{home});
    assert.equal(JSON.parse(dry.stdout).resubmit.length,1);
    const resume=await runCli(['--port',String(port),'generate','resume','demo'],{home});
    assert.equal(resume.code,0,resume.stderr);
    const manifest=JSON.parse(readFileSync(join(home,'runs/demo.json'),'utf8'));
    assert.equal(manifest.entries.length,1); assert.notEqual(manifest.entries[0].jobId,job);
  });
  await t.test('restart retains history and fails interrupted work',async () => {
    ws.terminate(); await halt(); await launch();
    const jobs=(await request('/jobs')).body.jobs;
    assert.ok(jobs.length>=2);
    assert.ok(jobs.some(j=>j.error==='bridge restarted while job was in flight'));
  });
});
