// Capture expectations from the supplied product, never from the replacement.
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCli, root } from '../test/helpers.js';
const entry = '../flow-connector-cli/bin/flow-auto.mjs';
const modes = ['text-to-video','frame-to-video','ingredients-to-video','text-to-image','image-to-image','flow-text-to-image','flow-image-to-image','flow-text-to-video','flow-frame-to-video','flow-ingredients-to-video','flow-video-to-video','flow-create-character','flow-set-voice','flow-extend-video','flow-rename-asset','flow-upload-assets'];
let received;
const server = createServer(async (req, res) => {
 res.setHeader('content-type', 'application/json');
 if (req.url.startsWith('/status')) return res.end(JSON.stringify({bridge:'up',bridgeVersion:'1.0.9',extensionConnected:true,plan:null}));
 if (req.method === 'POST' && req.url === '/jobs') {
   let body = ''; for await (const chunk of req) body += chunk;
   received = JSON.parse(body); return res.end('{"jobId":"fixture-job"}');
 }
 res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = String(server.address().port);
const scenarios = modes.map(mode => ({
 name: mode,
 args: ['generate','create',mode,'--prompt','A lighthouse at sunrise','--json',
   ...(mode === 'flow-video-to-video' ? ['--video','sample.mp4','--model','omni-flash'] : []),
   ...(mode === 'flow-upload-assets' ? ['--image','sample.png','second.jpg'] : []),
   ...(mode === 'flow-rename-asset' ? ['--asset','Old name','--name','New name'] : []),
 ],
}));
scenarios.push({ name:'full-video-options', args:['generate','create','flow-ingredients-to-video','--prompt','test','--image','sample.png','--asset','Scene','--character','Hero','--aspect-ratio','9:16','--duration','6','--resolution','360p','--model','omni-flash','--outputs','4','--new-project','--batch','8','--speed','6','--delay','10-15','--image-delay','2-3','--extend','2','--extend-prompt','continues','--step','beat one','beat two','--index','4','--name','Hero','--character-info','curious','--voice','Algenib','--voice-style','gentle','--voice-name','Narrator','--body','red coat','--json'] });
scenarios.push({name:'stdin', args:['generate','create','flow-text-to-image','--json'],input:'A prompt from stdin'});
try {
 for (const scenario of scenarios) {
   received = null;
   const result = await runCli(['--port',port,...scenario.args],{entry,input:scenario.input});
   if (result.code !== 0 || !received) throw new Error(`${scenario.name}: ${result.stderr}`);
   delete received.client;
   received.job.params.downloadSubfolder = '<brand-folder>';
   received.imagePaths = received.imagePaths.map(p => p.replace(root.replace(/[\\/]$/, ''), '<cwd>'));
   scenario.expected = received;
 }
 const helpPaths = [[],['bridge'],['bridge','start'],['doctor'],['status'],['stop'],['queue'],['queue','clear'],['modes'],['generate'],['generate','create'],['generate','list'],['generate','get'],['generate','wait'],['generate','cancel'],['generate','runs'],['generate','resume'],['reload-extension'],['merge'],['clean'],['skill'],['skill','install'],['skill','list']];
 const help = [];
 for (const args of helpPaths) {
   const r = await runCli([...args,'--help'],{entry});
   if(r.code !== 0) throw new Error(r.stderr);
   help.push({args, flags:[...r.stdout.matchAll(/^\s+(?:-[A-Za-z], )?(--[a-zA-Z-]+)/gm)].map(m=>m[1])});
 }
 mkdirSync(resolve(root,'test/fixtures'),{recursive:true});
 writeFileSync(resolve(root,'test/fixtures/compatibility.json'),JSON.stringify({source:'flow-connector-cli 1.0.9',scenarios,help},null,2));
 console.log(`Captured ${scenarios.length} payloads and ${help.length} command help surfaces.`);
} finally { server.closeAllConnections(); server.close(); }
