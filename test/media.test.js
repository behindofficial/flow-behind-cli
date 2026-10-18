import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, isolatedHome, runCli } from './helpers.js';
import { resolveFfmpeg } from '../src/commands/merge.js';
import { parseBox, cropFilter } from '../src/commands/dewatermark.js';

test('clean retains mark geometry and crop anchors', () => {
  const box=parseBox(undefined,1280,720,'flow',false);
  assert.deepEqual(box,{bx:1129,by:569,bw:64,bh:64});
  for(const anchor of ['auto','bottom','right','center','topleft']) assert.match(cropFilter(1280,720,box,anchor).vf,/crop=.*scale=1280:720/);
  assert.throws(()=>parseBox('100x100+50+50',100,100,'flow',true),/exceeds/);
  assert.throws(()=>parseBox('bad',100,100,'flow',true),/bad --box/);
  assert.ok(existsSync(join(root,'tools/inpaint.py')),'missing inpaint runner from original package must be restored');
});

test('ffmpeg merge and clean produce readable media', async t => {
  const tools=resolveFfmpeg();
  if(!tools) return t.skip('ffmpeg not installed');
  const home=isolatedHome();
  const video=join(home,'clip.mp4');
  const image=join(home,'reference.png');
  const logo=join(home,'logo.png');
  for(const [path,input,extra] of [
    [video,'color=c=blue:s=320x240:d=0.3',['-c:v','libx264','-pix_fmt','yuv420p']],
    [image,'color=c=blue:s=320x240',['-frames:v','1']],
    [logo,'color=c=white:s=32x32',['-frames:v','1']],
  ]) {
    const r=spawnSync(tools.ffmpeg,['-y','-f','lavfi','-i',input,...extra,path],{encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,r.stderr);
  }
  for(const fast of [false,true]) await t.test(`merge ${fast?'copy':'reencode'}`,async()=>{
    const output=join(home,`merge-${fast}.mp4`);
    const r=await runCli(['merge',video,video,'-o',output,'--json',...(fast?['--fast']:[])],{home});
    assert.equal(r.code,0,r.stderr); assert.equal(JSON.parse(r.stdout).inputs,2); assert.ok(existsSync(output));
    const probe=spawnSync(tools.ffprobe,['-v','error','-show_entries','format=duration','-of','json',output],{encoding:'utf8',windowsHide:true});
    assert.ok(Number(JSON.parse(probe.stdout).format.duration)>=0.5);
  });
  for(const mode of ['crop','delogo','cover']) await t.test(`clean ${mode}`,async()=>{
    const output=join(home,`${mode}.png`);
    const r=await runCli(['clean',image,'--mark','flow','--mode',mode,'--logo',logo,'-o',output,'--json'],{home});
    assert.equal(r.code,0,r.stderr); assert.equal(JSON.parse(r.stdout).mode,mode); assert.ok(existsSync(output));
  });
  await t.test('missing optional Python falls back only for implicit inpaint',async()=>{
    const env={PYTHON:join(home,'missing-python')};
    const implicit=await runCli(['clean',image,'--mark','flow','-o',join(home,'fallback.png'),'--json'],{home,env});
    assert.equal(implicit.code,0,implicit.stderr);
    assert.equal(JSON.parse(implicit.stdout).mode,'delogo');
    assert.match(implicit.stderr,/falling back/);
    const explicit=await runCli(['clean',image,'--mark','flow','--mode','inpaint','-o',join(home,'explicit.png')],{home,env});
    assert.notEqual(explicit.code,0);
    assert.match(explicit.stderr,/inpaint failed/);
  });
});
