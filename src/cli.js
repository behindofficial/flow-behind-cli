import { BRAND, STATE_DIR, updatesDisabled } from "./brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { BridgeClient } from "./bridge-client/index.js";
import { BRIDGE_DEFAULT_PORT, isUnlimitedDaily } from "./shared/protocol.js";
import { keepCurrent, rememberSkillDir } from "./commands/update.js";
import { startBridgeServer, BRIDGE_VERSION } from "./bridge/server.js";
import { runChecks, ffmpegPresent, skillPresent, format, anyFailed } from "./commands/doctor.js";
import { ModeSchema, JobParamsSchema, siteForMode, MODE_LIMITS, tooManyReferences } from "./shared/job.js";
import { parseDelay } from "./commands/delay.js";
import { appendToRun, readRun, runReport, listRuns, toResume } from "./commands/runs.js";
import { failedThisRun } from "./commands/failed.js";
import { resolveFfmpeg, mergeVideos } from "./commands/merge.js";
import { dewatermark } from "./commands/dewatermark.js";
import { installSkill, defaultSkillsDir, SKILLS, isBundled } from "./commands/skill.js";

import { Command } from "commander";
import { dirname as dirname4, join as join8, resolve as resolve2 } from "path";
import { homedir as homedir5 } from "os";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync4, writeFileSync as writeFileSync5 } from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
import { createRequire as createRequire2 } from "module";

var VERSION = BRAND.version;
var PACKAGE = BRAND.package;
var selfEntry = fileURLToPath3(import.meta.url);
function client(port) {
  return new BridgeClient({
    port,
    spawnArgs: [selfEntry, "--port", String(port), "bridge", "start"]
  });
}
async function readyClient(port) {
  const c = client(port);
  await c.ensureBridge();
  return c;
}
function printJob(job, asJson) {
  if (asJson) {
    console.log(JSON.stringify(job, null, 2));
    return;
  }
  const who = job.client ? `  [${job.client}]` : "";
  const line = `${job.id}  ${job.status}${job.stage ? ` (${job.stage})` : ""}  ${job.mode}${who}  "${job.prompt.slice(0, 50)}"`;
  console.log(line);
  if (job.status === "done") {
    for (const f of job.files) console.log(f.path);
    if (job.error) console.error(`warning: ${job.error}`);
  }
  if (job.status === "failed") {
    console.error(`error: ${job.error}`);
    if (POLICY_BLOCK.test(job.error ?? "")) {
      console.error(
        "policy-block: refused by the site's content policy. Rewrite the prompt before resubmitting - the same wording will be refused again. Nothing was generated."
      );
    }
  }
}
var POLICY_BLOCK = /violate(s)? our polic|content polic|moderat|not allowed|try a different prompt|blocked/i;
function notePlanChange(site, plan) {
  if (!plan) return;
  const file = join8(STATE_DIR, `plan-${site}`);
  let last = "";
  try {
    last = readFileSync4(file, "utf8").trim();
  } catch {
  }
  if (last === plan) return;
  try {
    mkdirSync6(dirname4(file), { recursive: true });
    writeFileSync5(file, plan);
  } catch {
  }
  if (!last) return;
  console.error(
    plan === "pro" ? "plan: PRO is now active \u2014 batching is on from the next batch onward (default --batch 4, ~3x faster). Nothing to restart." : `plan: now "${plan}" \u2014 batching is off, prompts run one at a time.`
  );
}
function printWaited(job, asJson) {
  printJob(job, asJson);
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") return;
  if (!asJson) {
    console.error(
      `still ${job.status} \u2014 the WAIT timed out, not the job. Nothing failed and nothing was lost. Check it with \`${PROGRAM} generate get ${job.id}\`, or raise --wait-timeout. Do NOT resubmit this prompt.`
    );
  }
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}
var PROGRAM = BRAND.command;
var IS_GROK = (process.env.CONNECTOR_BIN ?? "").startsWith("grok-auto");
var DEFAULT_FOLDER = IS_GROK ? "grok-auto" : BRAND.command;
var program = new Command().name(PROGRAM).description(
  IS_GROK ? "Drive grok.com/imagine batch generation through the Grok Imagine Connector extension" : "Flow Behind CLI — image, video, character and batch workflows by Flow Behind"
).version(VERSION).option("--port <n>", "bridge port", String(BRIDGE_DEFAULT_PORT));
program.hook("preAction", async (_, cmd) => {
  if (!PACKAGE || PACKAGE.startsWith("@") || updatesDisabled()) return;
  if (cmd.parent?.name() === "bridge") return;
  const name = cmd.name();
  const hears = name === "status" || name === "doctor" ? "always" : name === "create" ? "hourly" : "never";
  await keepCurrent(PACKAGE, VERSION, Number(program.opts().port) || BRIDGE_DEFAULT_PORT, hears);
});
var bridge = program.command("bridge").description("manage the local bridge daemon");
bridge.command("start").description("run the bridge daemon in the foreground").action(async () => {
  const port = Number(program.opts().port);
  await startBridgeServer(port);
});
program.command("doctor").description("check the whole chain and say what to fix").option("--site <site>", "grok or flow", "flow").option("--json", "machine-readable output").action(async (opts) => {
  const site = opts.site;
  const status = await client(Number(program.opts().port)).status(site).catch(() => null);
  const skillName = site === "flow" ? "flow-generate" : "grok-generate";
  const checks = runChecks({
    nodeVersion: process.version,
    status: status ?? null,
    cliBridgeVersion: BRIDGE_VERSION,
    site,
    ffmpegFound: ffmpegPresent(),
    platform: process.platform,
    skillInstalled: skillPresent(skillName),
    skillName,
    program: PROGRAM
  });
  console.log(opts.json ? JSON.stringify(checks, null, 2) : format(checks));
  if (anyFailed(checks)) process.exitCode = 1;
});
program.command("status").description("bridge + extension + plan status").option("--site <site>", "grok or flow", "grok").option("--json", "machine-readable output").action(async (opts) => {
  const site = opts.site;
  const c = client(Number(program.opts().port));
  const status = await c.status(site);
  if (opts.json) {
    console.log(JSON.stringify(status ?? { bridge: "down" }, null, 2));
    return;
  }
  if (!status) {
    console.log("bridge: down (it auto-starts on the next generate)");
    return;
  }
  const label = site === "flow" ? "Flow Connector" : "Grok Imagine Connector";
  console.log(`bridge: up (v${status.bridgeVersion})`);
  console.log(`extension (${site}): ${status.extensionConnected ? "connected" : `NOT CONNECTED \u2014 open the browser with the ${label} extension`}`);
  if (status.duplicateInstalls) {
    console.log(
      `WARNING: the ${label} is running in TWO places (two browsers or two browser profiles) and they keep disconnecting each other \u2014 jobs will stall. Tell the user: keep it open in ONE browser only; close the other browser or turn the extension off there (chrome://extensions or edge://extensions).`
    );
  }
  if (status.extensionConnected) {
    const quota = status.usage && status.limits && !isUnlimitedDaily(status.dailyLimit) ? `${status.usage.video}/${status.limits.video} videos, ${status.usage.image}/${status.limits.image} images today` : isUnlimitedDaily(status.dailyLimit) ? `${status.usedToday ?? 0} generated today` : `${status.usedToday ?? "?"}/${status.dailyLimit} today`;
    console.log(`plan: ${status.plan ?? "unknown"} (${quota})`);
    if (status.pausedReason) {
      console.log(`queue: PAUSED \u2014 ${status.pausedReason}`);
    }
    if (status.grokVisible === false) {
      console.log(`${site} tab: HIDDEN \u2014 bring it to the front, jobs will stall while it's hidden`);
    } else if (status.grokVisible === true) {
      console.log(`${site} tab: visible`);
    }
    if (status.flowAccess === "blocked") {
      console.log(
        "flow access: BLOCKED \u2014 Flow tab \u2192 puzzle icon (Extensions) \u2192 allow on this site; Manage extensions \u2192 Flow Connector \u2192 Details \u2192 Site access \u2192 turn on flow.google.com; reload the Flow tab."
      );
    }
    if (status.flowLayout === "narrow") {
      console.log(
        "flow window: NARROW (half-screen) \u2014 Flow is rendering its mobile layout. Ask the user to MAXIMISE the Flow window before any character work: --voice-style has no field to type into there and is refused."
      );
    } else if (status.flowLayout === "wide") {
      console.log("flow window: WIDE (full screen) \u2014 character work is available");
    }
    console.log(`active jobs: ${status.activeJobs}`);
    if (status.browser) console.log(`browser: ${status.browser}`);
    if (status.cooldownUntil) {
      const until = new Date(status.cooldownUntil).toLocaleTimeString();
      console.log(`cooldown: ACTIVE until ${until} (${status.lastWarning ?? "anti-bot warning"}) \u2014 wait, don't retry-loop`);
      if (site === "flow" && status.browser === "chrome") {
        console.log("tip: this cooldown is Chrome-specific \u2014 loading the same unpacked extension in Edge (edge://extensions \u2192 Load unpacked) is unaffected and can generate right away");
      }
    }
  }
});
program.command("stop").description("halt the queue and cancel every unfinished job").option("--site <site>", "grok or flow", "grok").action(async (opts) => {
  const c = await readyClient(Number(program.opts().port));
  const r = await c.stop(opts.site);
  console.log(
    r.delivered ? `stopped ${opts.site} \u2014 ${r.cancelled} job(s) cancelled` : `${opts.site} extension not connected \u2014 ${r.cancelled} queued job(s) cancelled here; anything already in the browser keeps running until you reload that tab`
  );
});
var queueCmd = program.command("queue").description("inspect and clear the generation queue");
queueCmd.command("clear").description("throw away finished/failed job history (extension + bridge)").option("--site <site>", "grok or flow", "grok").action(async (opts) => {
  const c = await readyClient(Number(program.opts().port));
  const r = await c.clearQueue(opts.site);
  console.log(
    `cleared ${r.removed} job(s) from the bridge` + (r.delivered ? " and asked the extension to clear its own history" : " (extension not connected)")
  );
});
program.command("modes").description("list generation modes").action(() => {
  console.log(
    [
      "text-to-image        prompt -> image(s)                    [grok]",
      "image-to-image       prompt + input image(s) -> image(s)   [grok]  --image (max 5)",
      "text-to-video        prompt -> video                       [grok]  --duration",
      "frame-to-video       prompt + start frame -> video         [grok]  --image --duration",
      "ingredients-to-video prompt + reference images -> video    [grok]  --image... --duration",
      "flow-text-to-image   prompt -> image(s)                    [flow]  --model nano-banana-pro|nano-banana-2|nano-banana-2-lite",
      "flow-image-to-image  prompt + input image(s) -> image(s)   [flow]  --image (max 10)",
      "flow-text-to-video   prompt -> video                       [flow]  --duration 4|6|8|10 --model omni-flash|veo-3.1-lite|veo-3.1-fast|veo-3.1-quality",
      "flow-frame-to-video  prompt + start/end frame -> video     [flow]  --image (1st=start, 2nd=end, max 2) --duration",
      "flow-ingredients-to-video  prompt + refs -> video          [flow]  --image/--asset (max 7 on omni-flash, 3 on Veo Lite/Fast) --duration",
      "flow-video-to-video  edit an existing clip -> video       [flow]  --video <file> (1 clip, 3-10s) --model omni-flash",
      "flow-create-character  prompt -> reusable character        [flow]  --name (no file output; reference it later with --asset <name>)",
      "flow-set-voice         voice for the OPEN character       [flow]  --voice --voice-style (no generation, no credits; also re-voices)",
      'flow-rename-asset      rename an asset in the project     [flow]  --asset "<current>" --name "<new>" (no generation, no credits)',
      "flow-upload-assets     bulk-import files into the project [flow]  --image a.jpg b.jpg ... (one upload for the lot, no generation, no credits)",
      "flow-extend-video    lengthen the clip open in the editor  [flow]  --prompt (what happens next) --extend <n> / --step <beat...>",
      "",
      "note: flow video only offers 16:9 / 9:16, and veo-3.1-quality is the expensive one.",
      "note: flow-extend-video is Veo-only and works on the clip currently open at /project/<id>/edit/<clip>."
    ].join("\n")
  );
});
var gen = program.command("generate").description("create and inspect generation jobs");
gen.command("create <mode>").description(`submit a generation job (mode: see \`${PROGRAM} modes\`)`).option("--prompt <text>", "prompt text (or pipe via stdin)").option("--image <path...>", "input image file(s)").option(
  "--video <path...>",
  "flow-video-to-video: source clip(s) to edit. Same upload path as --image \u2014 Flow attaches a video exactly like a reference image \u2014 this flag exists so the command reads honestly."
).option("--asset <name...>", "flow: reference asset(s) already in the project's + panel, by name").option("--character <name...>", "flow: cast character(s) by name \u2014 free of the reference cap, works on every flow mode").option("--aspect-ratio <ratio>", "16:9, 9:16, 1:1, 2:3, 3:2 (grok) or 4:3, 3:4 (flow)", "16:9").option("--duration <s>", "video duration \u2014 grok: 6, 10, 15 \u2014 flow omni-flash: 4, 6, 8, 10 (veo is fixed at 8s)").option(
  "--resolution <r>",
  "video resolution \u2014 flow: 360p or 720p. Flow remembers this per account, so without it a run inherits whatever was last clicked"
).option(
  "--model <m>",
  "grok: quality|speed \u2014 flow image: nano-banana-pro|nano-banana-2|nano-banana-2-lite \u2014 flow video: omni-flash|veo-3.1-lite|veo-3.1-fast|veo-3.1-quality"
).option("--outputs <n>", "outputs per prompt", "1").option("--new-project", "flow: start this batch in a brand-new Flow project").option(
  "--batch <n>",
  "flow: outputs submitted back-to-back before any are watched (default 4) \u2014 the main speed control"
).option(
  "--speed <1-6>",
  "flow: how hard to push. 1 safest, 5 fastest \u2014 sets BOTH the gap between generations and between batches. Higher means more refusals; it is the user's own Google account taking that risk. The extension's Safe mode clamps this to whatever they chose there."
).option(
  "--delay <range>",
  "flow: seconds between finished batches, e.g. 10-15 or 0 (default 10-15). Slowed automatically after an anti-bot strike"
).option(
  "--image-delay <range>",
  "flow: seconds between the individual generations inside one batch, e.g. 2-5 or 0. Same format as --delay; overrides --speed for that gap"
).option("--extend <n>", "auto-extend a video N times (chains +6s/+10s)", "0").option("--extend-prompt <text>", "prompt used for each extension").option("--step <text...>", "storyboard beats \u2014 one prompt per extension, in order (overrides --extend/--prompt)").option("--folder <name>", "download subfolder", DEFAULT_FOLDER).option(
  "--index <n>",
  "1-based position of this prompt in the batch \u2014 fixes the file number so a failed prompt leaves a gap instead of the next one taking its number"
).option("--name <text>", "flow-create-character: name to save the character under (also how you reference it later); flow-rename-asset: the new name").option("--character-info <text>", "flow-create-character: personality/quirks the Flow agent reads").option("--voice <name>", "flow-create-character: preset voice to attach, by name (e.g. Algenib)").option("--voice-style <text>", "flow-create-character: how the voice should sound (needs --voice)").option("--voice-name <text>", 'flow-create-character: save the customised voice under this name (default: "<preset> Custom")').option("--body <text>", "flow-create-character: description for the multi-angle Create Body sheet").option("--wait", "block until the job finishes and print file paths").option("--wait-timeout <min>", "wait timeout in minutes", "15").option("--json", "machine-readable output").action(
  async (modeArg, opts, cmd) => {
    const mode = ModeSchema.safeParse(modeArg);
    if (!mode.success) {
      console.error(`unknown mode "${modeArg}" \u2014 run \`${PROGRAM} modes\``);
      process.exit(1);
    }
    const prompt = opts.prompt ?? opts.step?.[0] ?? (mode.data === "flow-set-voice" ? opts.voice : void 0) ?? // flow-rename-asset prompts nothing either: --asset says what to rename
    // and --name says what to. Its "prompt" is just the pair, for the log.
    (mode.data === "flow-rename-asset" && opts.asset?.[0] && opts.name ? `rename ${opts.asset[0]} -> ${opts.name}` : void 0) ?? // Nothing to prompt: the files ARE the job.
    (mode.data === "flow-upload-assets" && (opts.image?.length ?? 0) > 0 ? `upload ${opts.image.length} asset(s)` : void 0) ?? await readStdin();
    if (!prompt) {
      console.error("missing --prompt (or pipe text via stdin)");
      process.exit(1);
    }
    const batchDelay = parseDelay(opts.delay);
    const imageDelay = parseDelay(opts.imageDelay, "--image-delay");
    const params = JobParamsSchema.parse({
      aspectRatio: opts.aspectRatio,
      videoOption: opts.duration ? `${opts.duration.replace(/s$/, "")}s` : void 0,
      // The schema's two values are Grok's (480p/720p); the extension maps
      // 480p onto Flow's 360p chip. Kept rather than widened because one
      // enum shared by both sites is what stops a Grok-only value reaching
      // Flow's composer and clicking nothing.
      videoResolution: opts.resolution === "720p" ? "720p" : opts.resolution === "360p" || opts.resolution === "480p" ? "480p" : void 0,
      imageModel: opts.model,
      outputsPerPrompt: Number(opts.outputs),
      newProject: opts.newProject ? true : void 0,
      batchOutputs: opts.batch ? Number(opts.batch) : void 0,
      speed: opts.speed ? Number(opts.speed) : void 0,
      delayMinSec: batchDelay?.minSec,
      delayMaxSec: batchDelay?.maxSec,
      imageDelayMinSec: imageDelay?.minSec,
      imageDelayMaxSec: imageDelay?.maxSec,
      autoExtendCount: Number(opts.extend),
      extendPrompt: opts.extendPrompt,
      extendSteps: opts.step,
      downloadSubfolder: opts.folder,
      autoRenameFiles: true,
      characterName: opts.name,
      characterInfo: opts.characterInfo,
      voiceName: opts.voice,
      voiceStyle: opts.voiceStyle,
      voiceSaveAs: opts.voiceName,
      bodyPrompt: opts.body
    });
    const assetRefs = opts.asset ?? [];
    const characterRefs = opts.character ?? [];
    const batchIndex = opts.index === void 0 ? void 0 : Number(opts.index);
    if (batchIndex !== void 0 && (!Number.isInteger(batchIndex) || batchIndex < 1)) {
      program.error("--index must be a whole number of 1 or more");
    }
    const spec = {
      prompt,
      mode: mode.data,
      params,
      inputImages: [],
      assetRefs,
      characterRefs,
      batchIndex
    };
    const imagePaths = [...opts.image ?? [], ...opts.video ?? []].map((p) => resolve2(p));
    if (opts.video?.length && mode.data !== "flow-video-to-video") {
      console.error(`note: --video is meant for flow-video-to-video, not ${mode.data}`);
    }
    if (mode.data === "flow-video-to-video" && opts.model && opts.model !== "omni-flash") {
      program.error("flow-video-to-video needs --model omni-flash \u2014 Veo cannot edit a clip");
    }
    if (characterRefs.length > 0 && siteForMode(mode.data) !== "flow") {
      console.error(`--character is flow-only (${mode.data} is a grok mode)`);
      process.exit(1);
    }
    if (characterRefs.length > 0 && mode.data === "flow-frame-to-video") {
      console.error(
        "--character does not work with flow-frame-to-video: Frames mode replaces the + panel with the Start/End slots. Use flow-text-to-video or flow-ingredients-to-video."
      );
      process.exit(1);
    }
    if (characterRefs.length > 0 && mode.data === "flow-extend-video") {
      console.error(
        "--character does not work with flow-extend-video: extend runs in the scene editor. Cast the character in the clip you extend from."
      );
      process.exit(1);
    }
    if (mode.data === "flow-upload-assets" && imagePaths.length === 0) {
      console.error("flow-upload-assets needs at least one --image");
      process.exit(1);
    }
    if (mode.data === "flow-rename-asset" && (!assetRefs[0] || !opts.name)) {
      console.error(
        'flow-rename-asset needs both --asset "<current name>" and --name "<new name>"'
      );
      process.exit(1);
    }
    const limits = MODE_LIMITS[mode.data];
    const refCount = imagePaths.length + assetRefs.length;
    const tooMany = tooManyReferences(mode.data, params.imageModel, refCount);
    if (tooMany) {
      console.error(`${tooMany} (--image + --asset)`);
      process.exit(1);
    }
    if (params.outputsPerPrompt > limits.maxOutputs) {
      console.error(`${mode.data} allows at most ${limits.maxOutputs} --outputs`);
      process.exit(1);
    }
    const site = siteForMode(mode.data);
    const c = client(Number(program.opts().port));
    const status = await c.ensureBridge(site);
    if (!status.extensionConnected && !opts.json) {
      const label = site === "flow" ? "Flow Connector" : "Grok Imagine Connector";
      const hint = site === "flow" ? "flow.google.com" : "grok.com/imagine";
      console.error(
        `note: ${site} extension not connected \u2014 job will wait. Open the browser with the ${label} extension and keep a visible ${hint} tab.`
      );
    }
    const { jobId } = await c.submitJob(spec, imagePaths);
    if (cmd.getOptionValueSource("folder") === "cli" && opts.folder) {
      appendToRun(opts.folder, { index: batchIndex, jobId, spec, imagePaths });
    }
    notePlanChange(site, status.plan);
    if (!opts.wait) {
      console.log(opts.json ? JSON.stringify({ jobId }) : jobId);
      return;
    }
    const job = await c.waitJob(jobId, Number(opts.waitTimeout) * 6e4, (reason) => console.error(`on hold: ${reason}`));
    printWaited(job, !!opts.json);
    if (job.status !== "done") process.exit(1);
  }
);
program.command("reload-extension").description("restart the browser extension (loads a new build; also un-wedges it)").option("--site <site>", "grok or flow", "grok").action(async (opts) => {
  const c = await readyClient(Number(program.opts().port));
  const { delivered } = await c.reloadExtension(opts.site);
  console.log(
    delivered ? `${opts.site} extension reloading \u2014 it reconnects in a few seconds` : `${opts.site} extension is not connected, nothing to reload`
  );
});
gen.command("list").description("list recent jobs").option("--json", "machine-readable output").option("--failed", "only the prompts that failed, with their number and reason").option("--all", "with --failed: every failure ever recorded, not just this run").option("--run <name>", "with --failed: report a recorded run by name, exactly").action(async (opts) => {
  const c = await readyClient(Number(program.opts().port));
  const jobs2 = await c.listJobs();
  if (opts.failed && opts.run) {
    const manifest = readRun(opts.run);
    if (!manifest) {
      console.error(
        `no record of a run called "${opts.run}" \u2014 \`${PROGRAM} generate runs\` lists the ones there are.`
      );
      process.exit(1);
    }
    const rows = runReport(manifest, jobs2).filter((r) => r.status !== "done" && r.status !== "pending");
    if (opts.json) {
      console.log(JSON.stringify(rows.map((r) => ({
        index: r.index ?? null,
        prompt: r.prompt,
        status: r.status,
        error: r.error ?? null,
        policyBlock: POLICY_BLOCK.test(r.error ?? "")
      })), null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log(`${opts.run}: nothing outstanding`);
      return;
    }
    console.log(`${opts.run}: ${rows.length} prompt(s) outstanding`);
    for (const r of rows) {
      const tag = POLICY_BLOCK.test(r.error ?? "") ? " [policy]" : "";
      console.log(`#${r.index ?? "?"}${tag}  ${r.prompt}`);
      console.log(`     ${r.status}${r.error ? `: ${r.error}` : ""}`);
    }
    console.log(`
re-submit them with \`${PROGRAM} generate resume ${opts.run}\``);
    return;
  }
  if (opts.failed) {
    const failed = failedThisRun(jobs2, opts.all).sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
    if (opts.json) {
      console.log(
        JSON.stringify(
          failed.map((j) => ({
            index: j.batchIndex ?? null,
            prompt: j.prompt,
            error: j.error ?? "unknown",
            policyBlock: POLICY_BLOCK.test(j.error ?? "")
          })),
          null,
          2
        )
      );
      return;
    }
    if (failed.length === 0) {
      console.log("no failed prompts");
      return;
    }
    console.log(`${failed.length} failed prompt(s):`);
    for (const j of failed) {
      const tag = POLICY_BLOCK.test(j.error ?? "") ? " [policy]" : "";
      console.log(`#${j.batchIndex ?? "?"}${tag}  ${j.prompt}`);
      console.log(`     why: ${j.error ?? "unknown"}`);
    }
    return;
  }
  if (opts.json) console.log(JSON.stringify(jobs2, null, 2));
  else for (const j of jobs2.slice(0, 20)) printJob(j, false);
});
gen.command("get <id>").description("show one job").option("--json", "machine-readable output").action(async (id, opts) => {
  const c = await readyClient(Number(program.opts().port));
  printJob(await c.getJob(id), !!opts.json);
});
gen.command("wait <id>").description("block until a job finishes").option("--timeout <min>", "timeout in minutes", "15").option("--json", "machine-readable output").action(async (id, opts) => {
  const c = await readyClient(Number(program.opts().port));
  const job = await c.waitJob(id, Number(opts.timeout) * 6e4, (reason) => console.error(`on hold: ${reason}`));
  printWaited(job, !!opts.json);
  if (job.status !== "done") process.exit(1);
});
gen.command("cancel <id>").description("cancel a queued job").action(async (id) => {
  const c = await readyClient(Number(program.opts().port));
  printJob(await c.cancelJob(id), false);
});
gen.command("runs").description("named runs this machine has a record of, newest first").action(() => {
  const runs = listRuns();
  if (runs.length === 0) {
    console.log("no runs recorded \u2014 pass --folder <name> on a batch to name one");
    return;
  }
  for (const r of runs) console.log(r);
});
gen.command("resume <run>").description("re-submit only the prompts of a run that did not finish").option("--dry-run", "list what would be re-submitted, submit nothing").option("--json", "machine-readable output").action(async (run3, opts) => {
  const manifest = readRun(run3);
  if (!manifest) {
    console.error(
      `no record of a run called "${run3}" \u2014 \`${PROGRAM} generate runs\` lists the ones there are. A run is recorded when a batch passes --folder <name>.`
    );
    process.exit(1);
  }
  const c = await readyClient(Number(program.opts().port));
  const rows = runReport(manifest, await c.listJobs());
  const todo = toResume(rows);
  const done = rows.filter((r) => r.status === "done").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  if (opts.json) {
    console.log(JSON.stringify({ run: run3, total: rows.length, done, pending, resubmit: todo }, null, 2));
    if (opts.dryRun) return;
  } else {
    console.log(`${run3}: ${rows.length} prompt(s) \u2014 ${done} done, ${pending} still running, ${todo.length} to re-submit`);
    for (const r of todo) {
      console.log(`  #${r.index ?? "?"}  ${r.status}${r.error ? ` (${r.error})` : ""}  "${r.prompt.slice(0, 60)}"`);
    }
  }
  if (todo.length === 0) {
    if (!opts.json) console.log(pending > 0 ? "nothing to do yet \u2014 wait for the running ones." : "nothing to do \u2014 this run is complete.");
    return;
  }
  if (opts.dryRun) {
    if (!opts.json) console.log("\n--dry-run: nothing submitted.");
    return;
  }
  const byId = new Map(manifest.entries.map((e) => [e.jobId, e]));
  let submitted = 0;
  for (const r of todo) {
    const entry = byId.get(r.jobId);
    if (!entry) continue;
    try {
      const { jobId } = await c.submitJob(entry.spec, entry.imagePaths);
      appendToRun(run3, { index: entry.index, jobId, spec: entry.spec, imagePaths: entry.imagePaths });
      submitted++;
      if (!opts.json) console.log(`  re-submitted #${entry.index ?? "?"} -> ${jobId}`);
    } catch (e) {
      console.error(`  #${entry.index ?? "?"} could not be re-submitted: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!opts.json) {
    console.log(`
${submitted} re-submitted. Watch them with \`${PROGRAM} generate list\`.`);
  }
});
program.command("merge <videos...>").description("concatenate videos into one file (ffmpeg). Accepts files, globs already expanded by the shell.").requiredOption("-o, --output <path>", "output file path (e.g. montage.mp4)").option("--fast", "stream-copy without re-encoding (faster, but may drift duration)").option("--json", "machine-readable output").action(async (videos, opts) => {
  const tools = resolveFfmpeg();
  if (!tools) {
    console.error(
      "ffmpeg not found. Install it (winget install Gyan.FFmpeg) or set FFMPEG_PATH to ffmpeg.exe."
    );
    process.exit(1);
  }
  if (videos.length < 2) {
    console.error("need at least 2 videos to merge");
    process.exit(1);
  }
  try {
    const r = await mergeVideos(videos, opts.output, tools, { fast: opts.fast });
    if (opts.json) console.log(JSON.stringify(r));
    else console.log(`merged ${r.inputs} clips (${r.method}) \u2192 ${r.output}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
});
program.command("clean <input>").description("remove the Grok/Flow mark from your own generation (image or video)").requiredOption("-o, --output <path>", "output file path").option("--mark <s>", "which site made it: grok | flow", "grok").option(
  "--mode <m>",
  "crop | delogo | cover | inpaint (default: crop, delogo for --mark flow)"
).option(
  "--cut <c>",
  "crop anchor: auto | bottom | right | center | topleft",
  "auto"
).option("--box <spec>", "explicit mark box as WxH+X+Y (default: auto corner box)").option("--logo <path>", "PNG to overlay in --mode cover").option("--json", "machine-readable output").action(
  async (input, opts) => {
    const mode = opts.mode;
    if (mode && !["crop", "delogo", "cover", "inpaint"].includes(mode)) {
      console.error(`unknown --mode "${opts.mode}" (crop | delogo | cover | inpaint)`);
      process.exit(1);
    }
    if (!["grok", "flow"].includes(opts.mark)) {
      console.error(`unknown --mark "${opts.mark}" (grok | flow)`);
      process.exit(1);
    }
    try {
      const r = await dewatermark(resolve2(input), resolve2(opts.output), {
        mode,
        mark: opts.mark,
        cut: opts.cut,
        box: opts.box,
        logo: opts.logo ? resolve2(opts.logo) : void 0
      });
      if (opts.json) console.log(JSON.stringify(r));
      else console.log(`${r.mode}: ${r.detail} \u2192 ${r.output}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
);
var skill = program.command("skill").description("install the agent skill that teaches Claude Code to drive this");
skill.command("install [name]").description(`copy a bundled SKILL.md into your agent's skills folder (default: flow-generate)`).option("--dir <path>", "skills directory (default: ~/.claude/skills)").option("--json", "machine-readable output").action(async (name, opts) => {
  try {
    const r = await installSkill(name ?? "flow-generate", opts.dir ? resolve2(opts.dir) : defaultSkillsDir());
    if (opts.dir) rememberSkillDir(resolve2(opts.dir));
    if (opts.json) {
      console.log(JSON.stringify(r));
      return;
    }
    const verb = {
      installed: "installed",
      updated: "updated",
      "already-current": "already up to date"
    }[r.status];
    console.log(`skill ${r.name}: ${verb} \u2014 ${r.target}`);
    if (r.status !== "already-current") {
      console.log("restart your agent session so it picks the skill up.");
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
});
skill.command("list").description("show the skills bundled with this CLI").action(() => {
  for (const [name, spec] of Object.entries(SKILLS)) {
    if (isBundled(name)) console.log(`${name.padEnd(16)} ${spec.description}`);
  }
});
program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
