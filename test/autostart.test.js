import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { isolatedHome, runCli } from './helpers.js';

test('first generation auto-starts the new daemon on the requested custom port',async t=>{
  const reservation=createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
  const port=reservation.address().port; await new Promise(r=>reservation.close(r));
  const base=`http://127.0.0.1:${port}`;
  t.after(async()=>{
    try {
      const status=await (await fetch(base+'/status')).json();
      if(status.bridgeProduct==='flow-behind-cli' && status.bridgePid!==process.pid) process.kill(status.bridgePid);
    } catch { /* test daemon already exited */ }
  });
  const result=await runCli(['--port',String(port),'generate','create','flow-text-to-image','--prompt','Autostart test','--json'],{home:isolatedHome()});
  assert.equal(result.code,0,result.stderr);
  const id=JSON.parse(result.stdout).jobId;
  const status=await (await fetch(base+'/status')).json();
  assert.equal(status.bridgeProduct,'flow-behind-cli');
  const job=await (await fetch(base+'/jobs/'+id)).json();
  assert.equal(job.status,'waiting_for_extension');
});
