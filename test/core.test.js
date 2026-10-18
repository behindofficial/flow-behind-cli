import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelay } from '../src/commands/delay.js';
import { failedThisRun } from '../src/commands/failed.js';
import { runReport, toResume } from '../src/commands/runs.js';
import { runChecks, anyFailed } from '../src/commands/doctor.js';
import { agentConfigOf, noticeLine } from '../src/shared/agent-notices.js';
import { versionAtLeast, maxReferences } from '../src/shared/job.js';
import { dueNotices, updateLine } from '../src/commands/update.js';

test('delay parsing, model caps, version checks and notices remain compatible',()=>{
  assert.deepEqual(parseDelay('15-10'),{minSec:10,maxSec:15});
  assert.deepEqual(parseDelay('1.5'),{minSec:1.5,maxSec:1.5});
  assert.throws(()=>parseDelay('-1'));
  assert.equal(maxReferences('flow-ingredients-to-video','omni-flash'),7);
  assert.equal(maxReferences('flow-ingredients-to-video','veo-3.1-quality'),0);
  assert.equal(versionAtLeast('1.2.4','1.2.4'),true);
  assert.equal(versionAtLeast('1.2.3','1.2.4'),false);
  const notice={id:'one',area:'video',state:'info',text:'Testing'};
  assert.deepEqual(agentConfigOf({agent:{notices:[notice]}}),{notices:[notice]});
  assert.match(noticeLine(notice),/notice \[video\]: Testing/);
  const state={agent:{notices:[notice]}};
  assert.equal(dueNotices(state,'hourly',10_000_000).length,1);
  assert.equal(dueNotices(state,'hourly',10_000_001).length,0);
  assert.match(updateLine('flow-behind-cli','1.0.0','1.1.0'),/flow-behind-cli@latest/);
});
test('failed-run reports suppress replaced failures; resume excludes live and done work',()=>{
  const jobs=[
    {id:'a',status:'done',batchIndex:1,params:{downloadSubfolder:'run'}},
    {id:'b',status:'failed',batchIndex:1,params:{downloadSubfolder:'run'}},
    {id:'c',status:'failed',batchIndex:2,params:{downloadSubfolder:'run'}},
    {id:'d',status:'running',batchIndex:3,params:{downloadSubfolder:'run'}},
  ];
  assert.deepEqual(failedThisRun(jobs).map(j=>j.id),['c']);
  const rows=runReport({entries:['a','c','d','missing'].map((jobId,index)=>({jobId,index,spec:{prompt:'p'}}))},jobs);
  assert.deepEqual(toResume(rows).map(r=>r.jobId),['c','missing']);
});
test('doctor identifies blocked access, hidden tabs, cooldowns and duplicate installs',()=>{
  const checks=runChecks({nodeVersion:'v20.0.0',cliBridgeVersion:'1.0.0',site:'flow',ffmpegFound:true,platform:'win32',skillInstalled:true,skillName:'flow-generate',program:'flow-behind',now:1,status:{bridgeVersion:'1.0.0',extensionConnected:true,loggedIn:true,grokVisible:false,flowAccess:'blocked',flowLayout:'narrow',duplicateInstalls:true,cooldownUntil:10000,pausedReason:'paused',plan:'pro'}});
  assert.ok(anyFailed(checks));
  for(const name of ['Tab visible','Flow access','One browser','Queue']) assert.equal(checks.find(c=>c.name===name).state,'fail');
  assert.equal(checks.find(c=>c.name==='Cooldown').state,'warn');
});
