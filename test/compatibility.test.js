import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, runCli, isolatedHome } from './helpers.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/compatibility.json', import.meta.url)));

test('all original commands and options remain available', async t => {
  for (const { args, flags } of fixture.help) {
    await t.test(args.join(' ') || 'root', async () => {
      const result = await runCli([...args, '--help']);
      assert.equal(result.code, 0, result.stderr);
      const actual = [...result.stdout.matchAll(/^\s+(?:-[A-Za-z], )?(--[a-zA-Z-]+)/gm)].map(m => m[1]);
      assert.deepEqual(actual, flags);
      assert.match(result.stdout, /flow-behind/);
    });
  }
});

test('wire payloads match the original for every mode and extended options', async t => {
  let received;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/status')) return res.end(JSON.stringify({bridge:'up',extensionConnected:true,plan:null}));
    if (req.method === 'POST' && req.url === '/jobs') {
      let body = ''; for await (const chunk of req) body += chunk;
      received = JSON.parse(body); return res.end('{"jobId":"fixture-job"}');
    }
    res.end('{}');
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const scenario of fixture.scenarios) {
    await t.test(scenario.name, async () => {
      received = null;
      const result = await runCli(['--port',String(server.address().port),...scenario.args],{input:scenario.input});
      assert.equal(result.code,0,result.stderr);
      assert.equal(JSON.parse(result.stdout).jobId,'fixture-job');
      assert.ok(received);
      assert.equal(received.job.params.downloadSubfolder,'flow-behind');
      delete received.client;
      received.job.params.downloadSubfolder = '<brand-folder>';
      // The original fixture was captured on Windows; compare path semantics
      // consistently on Linux CI without changing any other payload fields.
      const portablePath = p => p.replaceAll('\\', '/');
      received.imagePaths = received.imagePaths.map(p => portablePath(p.replace(root.replace(/[\\/]$/, ''), '<cwd>')));
      const expected = structuredClone(scenario.expected);
      expected.imagePaths = expected.imagePaths.map(portablePath);
      assert.deepEqual(received,expected);
    });
  }
});

test('invalid generation arguments fail before bridge submission', async t => {
  const cases = [
    ['unknown',[]],
    ['flow-text-to-image',['--outputs','5']],
    ['flow-frame-to-video',['--character','Hero']],
    ['flow-video-to-video',['--model','veo-3.1-fast']],
    ['flow-upload-assets',[]],
    ['flow-rename-asset',[]],
    ['flow-text-to-image',['--index','0']],
    ['flow-text-to-image',['--delay','bad']],
    ['flow-ingredients-to-video',['--model','veo-3.1-quality','--asset','ref']],
  ];
  for (const [mode,args] of cases) await t.test(`${mode} ${args.join(' ')}`, async () => {
    const result = await runCli(['generate','create',mode,'--prompt','test',...args]);
    assert.notEqual(result.code,0);
    assert.ok(result.stderr.length);
  });
});

test('bundled agent skill installs and reports current on repeat', async () => {
  const home = isolatedHome();
  const dir = resolve(home,'skills');
  const args = ['skill','install','flow-generate','--dir',dir,'--json'];
  const first = await runCli(args,{home});
  assert.equal(first.code,0,first.stderr);
  assert.equal(JSON.parse(first.stdout).status,'installed');
  const path = resolve(dir,'flow-generate/SKILL.md');
  assert.ok(existsSync(path));
  assert.match(readFileSync(path,'utf8'),/flow-behind generate/);
  const second = await runCli(args,{home});
  assert.equal(JSON.parse(second.stdout).status,'already-current');
});
