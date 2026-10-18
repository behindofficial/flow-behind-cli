#!/usr/bin/env node
// Flow Behind CLI — built from the editable src/ modules.

// src/brand.js
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var PACKAGE_INFO = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
var BRAND = Object.freeze({
  name: "Flow Behind CLI",
  company: "Flow Behind",
  command: "flow-behind",
  mcpCommand: "flow-behind-mcp",
  package: PACKAGE_INFO.name,
  version: PACKAGE_INFO.version
});
var STATE_DIR = process.env.FLOW_BEHIND_HOME ? resolve(process.env.FLOW_BEHIND_HOME) : join(homedir(), ".flow-behind");
var updatesDisabled = () => Boolean(
  process.env.FLOW_BEHIND_NO_UPDATE_CHECK || process.env.FLOW_AUTO_NO_UPDATE_CHECK
);

// src/bridge-client/index.js
import { spawn } from "node:child_process";
import { basename } from "node:path";

// src/shared/zod.js
import { z as external_exports } from "zod";

// src/shared/job.js
var ModeSchema = external_exports.enum([
  "text-to-video",
  "frame-to-video",
  "ingredients-to-video",
  "text-to-image",
  "image-to-image",
  "flow-text-to-image",
  "flow-image-to-image",
  "flow-text-to-video",
  "flow-frame-to-video",
  "flow-ingredients-to-video",
  "flow-video-to-video",
  "flow-create-character",
  "flow-set-voice",
  "flow-extend-video",
  "flow-rename-asset",
  "flow-upload-assets"
]);
function siteForMode(mode) {
  return mode.startsWith("flow-") ? "flow" : "grok";
}
var MODE_LIMITS = {
  "text-to-image": { maxInputImages: 0, maxOutputs: 12 },
  "image-to-image": { maxInputImages: 5, maxOutputs: 12 },
  "frame-to-video": { maxInputImages: 1, maxOutputs: 1 },
  "ingredients-to-video": { maxInputImages: 7, maxOutputs: 1 },
  "text-to-video": { maxInputImages: 0, maxOutputs: 1 },
  "flow-text-to-image": { maxInputImages: 0, maxOutputs: 4 },
  "flow-image-to-image": { maxInputImages: 10, maxOutputs: 4 },
  "flow-text-to-video": { maxInputImages: 0, maxOutputs: 4 },
  // Flow's Frames sub-mode has exactly two slots on the composer: Start and End.
  "flow-frame-to-video": { maxInputImages: 2, maxOutputs: 4 },
  // The mode's ceiling. The real cap is the MODEL's — see maxReferences().
  "flow-ingredients-to-video": { maxInputImages: 7, maxOutputs: 4 },
  // Editing an existing clip. Mechanically identical to ingredients — the
  // video is uploaded and attached the same way an image is, and Flow shows
  // it in the same asset list with a "Video" badge — but it takes exactly ONE
  // clip and only Omni Flash can do it. Flow itself only edits 3-10s clips.
  "flow-video-to-video": { maxInputImages: 1, maxOutputs: 4 },
  // A setup action, not a generation: it produces a reusable character rather
  // than a file to download. Its page does have a "+" for reference images,
  // but that path is unverified, so references are refused rather than
  // silently ignored.
  // ponytail: maxInputImages 0 until the create page's + panel is confirmed live.
  "flow-create-character": { maxInputImages: 0, maxOutputs: 1 },
  // Voice-only pass over the character already open in Flow's editor. Costs
  // nothing (no portrait is generated) and is the only way to RE-voice a
  // character, since Flow hides "Select a voice" once one is attached.
  "flow-set-voice": { maxInputImages: 0, maxOutputs: 1 },
  // Lengthens the clip already open in Flow's scene editor rather than
  // generating a new one: no references, and the single "output" is the
  // re-rendered clip. Veo-only — the Extend menu item does not exist on a clip
  // that was generated with Omni Flash (user-confirmed 2026-08-05).
  "flow-extend-video": { maxInputImages: 0, maxOutputs: 1 },
  // Renames an asset already in the project. `--asset` names the one to rename
  // and does NOT occupy a reference slot on a prompt, so the cap here is about
  // the mode generating nothing rather than about references.
  "flow-rename-asset": { maxInputImages: 1, maxOutputs: 1 },
  // Bulk import: put a folder of references into the project and generate
  // nothing. FLOW imposes no limit — measured live, its file input is
  // multiple=true and took 25 in one click — so this number is not about Flow.
  // It is about this side: the files arrive as base64 over the bridge and are
  // held in memory at once, and a ~2 MB jpg is ~2.7 MB as base64. The upload
  // itself is chunked (see uploadAssets), so what is left is the resolve step.
  "flow-upload-assets": { maxInputImages: 500, maxOutputs: 1 }
};
var VEO_INGREDIENTS_MAX = 3;
var INGREDIENTS_MAX = { "omni-flash": 7, "veo-3.1-quality": 0 };
function maxReferences(mode, model) {
  if (mode !== "flow-ingredients-to-video") return MODE_LIMITS[mode].maxInputImages;
  return INGREDIENTS_MAX[model ?? ""] ?? VEO_INGREDIENTS_MAX;
}
function tooManyReferences(mode, model, got) {
  const max = maxReferences(mode, model);
  if (got <= max) return null;
  const why = mode === "flow-ingredients-to-video" ? ` on ${model ?? "an unnamed model"} \u2014 omni-flash takes ${INGREDIENTS_MAX["omni-flash"]}, veo-3.1-lite and -fast take ${VEO_INGREDIENTS_MAX}, veo-3.1-quality takes none; name the model with --model` : "";
  return `${mode} allows at most ${max} reference(s)${why}, got ${got}`;
}
var MANY_INGREDIENTS_EXT = "1.2.4";
function versionAtLeast(have, want) {
  if (!have) return false;
  const a = have.split(".").map(Number);
  const b = want.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
var AspectRatioSchema = external_exports.enum(["16:9", "9:16", "1:1", "2:3", "3:2", "4:3", "3:4"]);
var VideoOptionSchema = external_exports.enum([
  "4s",
  "6s",
  "8s",
  "10s",
  "15s",
  "6s-concat",
  "10s-concat",
  "15s-concat"
]);
var ImageModelSchema = external_exports.enum([
  "quality",
  "speed",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana-2-lite",
  "omni-flash",
  "veo-3.1-lite",
  "veo-3.1-fast",
  "veo-3.1-quality"
]);
var VideoResolutionSchema = external_exports.enum(["480p", "720p"]);
var ImageModeOptionSchema = external_exports.enum(["new-image", "image-to-image"]);
var VideoQualitySchema = external_exports.enum(["480p", "720p", "1080p"]);
var ImageQualitySchema = external_exports.enum(["1k", "2k", "4k"]);
var InputImageRefSchema = external_exports.object({
  /** Library id (extension-side) or bridge file token (bridge-side). */
  id: external_exports.string(),
  name: external_exports.string(),
  mime: external_exports.string(),
  /** Where the bytes live. */
  source: external_exports.enum(["library", "bridge-token"])
});
var JobParamsSchema = external_exports.object({
  aspectRatio: AspectRatioSchema.default("16:9"),
  videoOption: VideoOptionSchema.optional(),
  videoResolution: VideoResolutionSchema.optional(),
  /** Auto-extend a generated video N times (chains +6s/+10s each). 0 = off.
   * In Extend mode this is driven by the number of prompts (one 6s beat each).
   * For `flow-extend-video` it is how many times to extend the open clip, and
   * 0 means one extend (there is nothing else for that mode to do). */
  autoExtendCount: external_exports.number().int().min(0).max(50).default(0),
  /** Prompt used for each extension (falls back to the main prompt). */
  extendPrompt: external_exports.string().optional(),
  /** Per-extension prompts (storyboard): extension i uses extendSteps[i-1].
   * Falls back to extendPrompt/prompt when absent. */
  extendSteps: external_exports.array(external_exports.string()).optional(),
  /** Fall back 720p→480p when the 720p quota is exhausted. */
  autoSwitchOnQuota: external_exports.boolean().optional(),
  imageModel: ImageModelSchema.optional(),
  imageModeOption: ImageModeOptionSchema.optional(),
  outputsPerPrompt: external_exports.number().int().min(1).max(12).default(1),
  /** Flow: start this batch in a brand-new project instead of whatever is
   * currently open. Without it, consecutive batches pile into the same
   * project — fine for one session, messy for a day's work. */
  newProject: external_exports.boolean().optional(),
  /** Flow: how many outputs' worth of prompts to submit back-to-back into one
   * tab before watching any of them. The whole batch generates concurrently
   * server-side, so this is the main speed control. Absent = the extension's
   * default. */
  batchOutputs: external_exports.number().int().min(1).max(12).optional(),
  /**
   * How hard to push, 1 (safest) to 6 (8x).
   *
   * Sets BOTH gaps — between generations inside a batch and between finished
   * batches — so an agent has one number to reason about instead of four.
   * The extension's Safe mode clamps this down to the user's own setting: it
   * is their Google account that carries the risk, not an API key.
   */
  speed: external_exports.number().int().min(1).max(6).optional(),
  /** Flow: the pause between finished batches, in seconds. The caller owns
   * this; the extension only ever stretches it after an anti-bot strike, never
   * shortens it. Absent = the extension's default. */
  delayMinSec: external_exports.number().min(0).max(600).optional(),
  delayMaxSec: external_exports.number().min(0).max(600).optional(),
  /** Flow: the pause between the individual generations inside one batch, in
   * seconds. Same contract as delay*Sec above, different gap — this is the one
   * that decides how fast prompts hit the composer. Absent = the speed dial. */
  imageDelayMinSec: external_exports.number().min(0).max(600).optional(),
  imageDelayMaxSec: external_exports.number().min(0).max(600).optional(),
  downloadVideoQuality: VideoQualitySchema.default("720p"),
  downloadImageQuality: ImageQualitySchema.default("1k"),
  downloadSubfolder: external_exports.string().default(""),
  autoRenameFiles: external_exports.boolean().default(true),
  /** flow-create-character: the name to save the character under, which is
   * also the handle it gets referenced by later (`--asset "<name>"`). Flow
   * defaults it to "Untitled Character", so leaving this unset makes a second
   * character collide with the first. */
  characterName: external_exports.string().optional(),
  /** flow-create-character: "Character Info" — baseline personality/quirks.
   * Flow feeds this to its Agent, so it shapes how the character behaves in
   * scenes without being repeated in every prompt. */
  characterInfo: external_exports.string().optional(),
  /** flow-create-character: preset voice to attach, by name (e.g. "Algenib").
   * Flow has no voice upload/cloning — presets only. */
  voiceName: external_exports.string().optional(),
  /** flow-create-character: "Customize Performance" — how the voice should
   * sound (pacing, tone, accent). Only meaningful alongside voiceName. */
  voiceStyle: external_exports.string().optional(),
  /** flow-create-character: name for the custom voice a voiceStyle creates.
   * Flow defaults it to "<preset> Custom", so two characters built from the
   * same preset collide - and this name is the handle voiceName reuses later. */
  voiceSaveAs: external_exports.string().optional(),
  /** flow-create-character: description for the "Create Body" sheet (the
   * multi-angle full-body reference). Empty = portrait only. */
  bodyPrompt: external_exports.string().optional()
});
var JobStatusSchema = external_exports.enum([
  "queued",
  "waiting_for_extension",
  "running",
  "downloading",
  "done",
  "failed",
  "cancelled"
]);
var JobStageSchema = external_exports.enum([
  "acquiring-tab",
  "preparing-page",
  "applying-mode",
  "applying-settings",
  "attaching-images",
  "entering-prompt",
  "submitting",
  "generating",
  "collecting-results",
  "downloading"
]);
var JobResultFileSchema = external_exports.object({
  /** Absolute path once known (bridge/CLI side); Downloads-relative in extension. */
  path: external_exports.string(),
  kind: external_exports.enum(["image", "video"])
});
var JobSpecSchema = external_exports.object({
  prompt: external_exports.string().min(1),
  mode: ModeSchema,
  params: JobParamsSchema,
  inputImages: external_exports.array(InputImageRefSchema).default([]),
  /** Flow only: names of assets ALREADY in the project's asset panel (past
   * uploads or earlier generations) to add as references instead of
   * re-uploading the bytes. Matched as a substring of the asset's label.
   * Counts against the same maxInputImages cap as inputImages. */
  assetRefs: external_exports.array(external_exports.string()).optional(),
  /** Flow only: names of CHARACTERS to cast in this prompt. Deliberately not
   * assetRefs: a character is not an ingredient and does NOT consume a
   * reference slot, so these are exempt from maxInputImages — which is the
   * whole point, since flow-text-to-image and flow-text-to-video allow zero
   * references and are exactly where character consistency matters most.
   * Attached through the same asset panel (characters are listed in it), and
   * adding one is idempotent. */
  characterRefs: external_exports.array(external_exports.string()).optional(),
  /** 1-based position of this prompt in its batch — used for the file number so
   * a failed prompt leaves a gap (prompt 3 stays "3 - …" even if 2 failed).
   * On JobSpec so it survives the CLI/bridge path (POST /jobs → job.submit),
   * not just UI batches. */
  batchIndex: external_exports.number().int().optional()
});
var JobSchema = JobSpecSchema.extend({
  id: external_exports.string(),
  status: JobStatusSchema,
  source: external_exports.enum(["ui", "bridge"]),
  createdAt: external_exports.number(),
  updatedAt: external_exports.number(),
  attempts: external_exports.number().int().default(0),
  maxRetries: external_exports.number().int().min(0).max(20).default(3),
  stage: JobStageSchema.optional(),
  error: external_exports.string().optional(),
  retryable: external_exports.boolean().optional(),
  files: external_exports.array(JobResultFileSchema).default([]),
  /** Tab currently running this job (extension-internal). */
  tabId: external_exports.number().optional()
});

// src/shared/protocol.js
var BRIDGE_DEFAULT_PORT = 8791;
var BRIDGE_HOST = "127.0.0.1";
var SiteSchema = external_exports.enum(["grok", "flow"]);
var BrowserSchema = external_exports.enum(["chrome", "edge", "other"]);
var BridgeFileMetaSchema = external_exports.object({
  token: external_exports.string(),
  name: external_exports.string(),
  mime: external_exports.string(),
  size: external_exports.number()
});
var ExtToBridgeSchema = external_exports.discriminatedUnion("t", [
  external_exports.object({
    t: external_exports.literal("ext.hello"),
    extVersion: external_exports.string(),
    loggedIn: external_exports.boolean(),
    plan: external_exports.string(),
    site: SiteSchema.default("grok"),
    browser: BrowserSchema.optional(),
    /**
     * Jobs this extension is actually running, as of connecting.
     *
     * A fresh hello means the extension just started, so anything the bridge
     * still has at "running" that is NOT in this list died with the previous
     * instance and is never coming back. Optional, and absence means "don't
     * know" rather than "none" — an extension that does not send it keeps the
     * old behaviour instead of having its live jobs requeued underneath it.
     */
    runningJobIds: external_exports.array(external_exports.string()).optional(),
    /** Whether this install has a Flow tab, and whether one is on screen. The
     * bridge keeps the install the user is actually on when two are running
     * (Chrome + Edge, two profiles) instead of letting them evict each other. */
    flowTab: external_exports.boolean().optional(),
    flowVisible: external_exports.boolean().optional()
  }),
  external_exports.object({ t: external_exports.literal("ext.heartbeat") }),
  // NOTE: `dailyLimit` travels as a finite number because these messages are
  // JSON — `Infinity` would serialize to `null` and fail `z.number()`. Use
  // UNLIMITED_DAILY / isUnlimitedDaily below to express "no cap".
  external_exports.object({
    t: external_exports.literal("ext.status"),
    loggedIn: external_exports.boolean(),
    plan: external_exports.string(),
    usedToday: external_exports.number(),
    dailyLimit: external_exports.number(),
    // Flow's free tier meters videos and images separately (they cost wildly
    // different amounts), which a single usedToday/dailyLimit pair cannot
    // express. Optional so the Grok extension, which has no tiers at all,
    // keeps validating unchanged.
    usage: external_exports.object({ video: external_exports.number(), image: external_exports.number() }).optional(),
    limits: external_exports.object({ video: external_exports.number(), image: external_exports.number() }).optional(),
    // Why the queue is holding, when it is holding for a reason the caller can
    // fix (free tier with the side panel closed). Cooldowns have their own
    // fields; this is for everything else, and null means "not paused".
    pausedReason: external_exports.string().nullable().optional(),
    activeJobs: external_exports.number(),
    // Whether a grok.com tab is open, active, and in a non-minimised window.
    // Hidden/minimised tabs are throttled by Chrome and generation stalls, so
    // an agent needs to know this the instant it changes — the extension pushes
    // a fresh status on every focus/tab change. Nullable for older bridges.
    grokVisible: external_exports.boolean().nullable().optional(),
    /** Flow only: which layout the page is rendering. Width is a feature flag
     * there — the narrow one has no "Customize performance" field and no
     * Characters sidebar — so an agent needs to be able to see it. */
    flowLayout: external_exports.enum(["wide", "narrow"]).nullable().optional(),
    /** Flow only: "blocked" when the browser will not run the extension on Flow. */
    flowAccess: external_exports.enum(["ok", "blocked"]).nullable().optional(),
    // Flow's anti-bot cooldown state (unused/absent on the grok extension).
    cooldownUntil: external_exports.number().nullable().optional(),
    lastWarning: external_exports.string().nullable().optional(),
    browser: BrowserSchema.optional()
  }),
  external_exports.object({ t: external_exports.literal("job.accepted"), jobId: external_exports.string() }),
  external_exports.object({
    t: external_exports.literal("job.progress"),
    jobId: external_exports.string(),
    stage: JobStageSchema,
    pct: external_exports.number().optional(),
    message: external_exports.string().optional()
  }),
  external_exports.object({
    t: external_exports.literal("job.result"),
    jobId: external_exports.string(),
    files: external_exports.array(JobResultFileSchema),
    // A "done" job can still carry a warning — e.g. an auto-extend chain that
    // stopped short of the requested length but downloaded what it had. Present
    // only in that case; a normal full success omits it.
    warning: external_exports.string().optional()
  }),
  external_exports.object({
    t: external_exports.literal("job.failed"),
    jobId: external_exports.string(),
    reason: external_exports.string(),
    retryable: external_exports.boolean()
  }),
  external_exports.object({
    t: external_exports.literal("healthcheck.result"),
    entries: external_exports.array(
      external_exports.object({
        key: external_exports.string(),
        matched: external_exports.boolean(),
        strategy: external_exports.string().optional(),
        snippet: external_exports.string().optional()
      })
    ),
    /** Raw page fingerprint (button labels, testids, dialog/list markup) — the
     * content script already collects it for the side panel; forwarding it
     * here is what makes selectors authorable without a console session. */
    diagnostics: external_exports.unknown().optional()
  }),
  external_exports.object({
    t: external_exports.literal("dom.result"),
    url: external_exports.string().optional(),
    roots: external_exports.number().optional(),
    items: external_exports.array(external_exports.unknown())
  }),
  external_exports.object({
    t: external_exports.literal("logs.result"),
    entries: external_exports.array(
      external_exports.object({
        ts: external_exports.number(),
        level: external_exports.string(),
        scope: external_exports.string(),
        message: external_exports.string()
      })
    )
  })
]);
var BridgeToExtSchema = external_exports.discriminatedUnion("t", [
  external_exports.object({ t: external_exports.literal("bridge.hello"), bridgeVersion: external_exports.string() }),
  external_exports.object({
    t: external_exports.literal("job.submit"),
    jobId: external_exports.string(),
    job: JobSpecSchema,
    inputFiles: external_exports.array(BridgeFileMetaSchema)
  }),
  external_exports.object({ t: external_exports.literal("job.cancel"), jobId: external_exports.string() }),
  // Halt the whole queue. `job.cancel` only reaches jobs one id at a time, which
  // is no use when a batch is misbehaving and the caller wants everything to
  // stop now (2026-09-02: Flow had no stop at all — stopQueue() existed in the
  // scheduler with no route reaching it).
  external_exports.object({ t: external_exports.literal("queue.stop") }),
  // Throw away finished/failed history. The extension keeps it in
  // chrome.storage.local and nothing shortened it, so a long-running install
  // accumulates hundreds of dead jobs.
  external_exports.object({ t: external_exports.literal("queue.clear") }),
  // Restart the extension. Chrome does not reload an unpacked extension when
  // its files change, and reloading the TAB does not help — the new build only
  // takes effect after the extension itself is reloaded, which was a manual
  // trip to chrome://extensions after every build. It is also the honest fix
  // for a wedged service worker, which users hit too.
  external_exports.object({ t: external_exports.literal("ext.reload") }),
  external_exports.object({ t: external_exports.literal("status.query") }),
  external_exports.object({ t: external_exports.literal("healthcheck.run") }),
  external_exports.object({ t: external_exports.literal("logs.query") }),
  // Ask the page for its live DOM so selectors can be authored from what is
  // really there. `selector` scopes the dump; `clickFirst` opens a panel that
  // only exists while open (the settings pill, the + menu).
  external_exports.object({
    t: external_exports.literal("dom.query"),
    selector: external_exports.string().optional(),
    clickFirst: external_exports.string().optional()
  })
]);
var SubmitJobRequestSchema = external_exports.object({
  job: JobSpecSchema,
  imagePaths: external_exports.array(external_exports.string()).default([]),
  /**
   * Who is submitting — a short label, not an identity.
   *
   * One bridge serves every agent and terminal on the machine, and they all
   * feed ONE extension queue. Two of them running batches at once doubles the
   * real request rate while each sees only its own half, which is how a run
   * that looked well-paced got refused (2026-09-02: a second session had put
   * 49 prompts through in 23 minutes). Labelling the submitter is what makes
   * that visible instead of mysterious.
   */
  client: external_exports.string().max(64).optional()
});
var SubmitJobResponseSchema = external_exports.object({
  jobId: external_exports.string(),
  /** Set when ANOTHER client already has jobs in flight — see `client` above. */
  warning: external_exports.string().optional()
});
var BridgeStatusSchema = external_exports.object({
  bridge: external_exports.literal("up"),
  bridgeVersion: external_exports.string(),
  extensionConnected: external_exports.boolean(),
  /** Build of the connected extension. Absent when nothing is connected, or
   * when it predates this field — optional so an older one still validates. */
  extensionVersion: external_exports.string().optional(),
  loggedIn: external_exports.boolean().nullable(),
  plan: external_exports.string().nullable(),
  usedToday: external_exports.number().nullable(),
  dailyLimit: external_exports.number().nullable(),
  // Flow only: the per-kind free-tier meters behind usedToday/dailyLimit.
  usage: external_exports.object({ video: external_exports.number(), image: external_exports.number() }).optional(),
  limits: external_exports.object({ video: external_exports.number(), image: external_exports.number() }).optional(),
  pausedReason: external_exports.string().nullable().optional(),
  activeJobs: external_exports.number(),
  // null = unknown (older extension, or not reported yet). false = a grok tab
  // exists but is hidden/minimised (jobs will stall). true = ready.
  grokVisible: external_exports.boolean().nullable(),
  /** Flow only: "narrow" means Flow switched to its mobile layout, where the
   * Characters sidebar and the voice dialog's "Customize performance" field do
   * not exist. Null when no live tab could be asked. */
  flowLayout: external_exports.enum(["wide", "narrow"]).nullable().optional(),
  /** Flow only: "blocked" = the browser refuses to run the extension on Flow. */
  flowAccess: external_exports.enum(["ok", "blocked"]).nullable().optional(),
  // Flow only: epoch ms the anti-bot cooldown lifts, and the warning that
  // triggered it. Both null/absent outside a cooldown.
  cooldownUntil: external_exports.number().nullable().optional(),
  lastWarning: external_exports.string().nullable().optional(),
  /** Two installs of the same extension (two browsers/profiles) keep taking
   * the one bridge slot from each other; neither can run a job reliably. */
  duplicateInstalls: external_exports.boolean().optional(),
  // Flow only: which browser the currently-connected extension is running
  // in. Chrome and Edge have separate extension storage, so a Chrome-side
  // cooldown never applies to Edge — this is the field that makes "switch to
  // Edge" a real, immediate unblock rather than a guess.
  browser: BrowserSchema.optional()
});
var BridgeJobSchema = JobSchema.omit({ tabId: true }).extend({
  client: external_exports.string().optional()
});
var UNLIMITED_DAILY = Number.MAX_SAFE_INTEGER;
function isUnlimitedDaily(limit) {
  return limit == null || limit >= UNLIMITED_DAILY;
}

// src/bridge-client/index.js
var terminal = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
var delay = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var BridgeClient = class {
  constructor(options = {}) {
    this.opts = options;
    this.base = `http://127.0.0.1:${options.port ?? BRIDGE_DEFAULT_PORT}`;
  }
  async fetchJson(path, options) {
    const response = await fetch(this.base + path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }
  async status(site) {
    try {
      return await this.fetchJson(site ? `/status?site=${encodeURIComponent(site)}` : "/status");
    } catch {
      return null;
    }
  }
  async ensureBridge(site) {
    const existing = await this.status(site);
    if (existing) return existing;
    if (!this.opts.spawnArgs?.length) throw new Error("bridge not running and no spawnArgs given");
    const child = spawn(process.execPath, this.opts.spawnArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    let spawnError;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(250);
      if (spawnError) throw new Error(`bridge failed to start: ${spawnError.message}`);
      const status = await this.status(site);
      if (status) return status;
    }
    throw new Error("bridge failed to start within 5s");
  }
  post(path, body) {
    return this.fetchJson(path, {
      method: "POST",
      ...body === void 0 ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    });
  }
  submitJob(job, imagePaths = []) {
    const client2 = (process.env.FLOW_BEHIND_CLIENT || process.env.GROK_AUTO_CLIENT || basename(process.cwd())).slice(0, 64);
    return this.post("/jobs", { job, imagePaths, client: client2 });
  }
  getJob(id) {
    return this.fetchJson(`/jobs/${encodeURIComponent(id)}`);
  }
  async listJobs() {
    return (await this.fetchJson("/jobs")).jobs;
  }
  cancelJob(id) {
    return this.post(`/jobs/${encodeURIComponent(id)}/cancel`);
  }
  stop(site) {
    return this.post(`/stop?site=${encodeURIComponent(site)}`);
  }
  clearQueue(site) {
    return this.post(`/queue/clear?site=${encodeURIComponent(site)}`);
  }
  reloadExtension(site) {
    return this.post(`/reload-extension?site=${encodeURIComponent(site)}`);
  }
  async waitJob(id, timeoutMs = 6e5, onHold) {
    const deadline = Date.now() + timeoutMs;
    let previousHold = "";
    for (; ; ) {
      const slice = Math.min(6e4, Math.max(1e3, deadline - Date.now()));
      const job = await this.fetchJson(`/jobs/${encodeURIComponent(id)}/wait?timeoutMs=${slice}`);
      if (terminal.has(job.status) || Date.now() >= deadline) return job;
      if (!onHold) continue;
      const status = await this.status(siteForMode(job.mode));
      const hold = status?.pausedReason || (status?.cooldownUntil > Date.now() ? `cooling down until ${new Date(status.cooldownUntil).toLocaleTimeString()}` : "");
      if (hold && hold !== previousHold) onHold(hold);
      previousHold = hold;
    }
  }
};

// src/commands/skill.js
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync as existsSync3 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname2, join as join4 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var SKILLS = {
  "flow-generate": {
    pkgDir: "skill-flow",
    pkg: BRAND.package,
    description: "Flow Behind: Google Flow (Nano Banana / Veo) image + video generation"
  },
  "grok-generate": {
    pkgDir: "skill",
    pkg: "grok-imagine-connector",
    description: "grok.com/imagine image + video generation"
  }
};
var here = dirname2(fileURLToPath2(import.meta.url));
function sourceCandidates(name, pkgDir) {
  return [
    join4(PACKAGE_ROOT, "skills", name, "SKILL.md"),
    join4(here, "..", "..", pkgDir, "SKILL.md")
  ];
}
function isBundled(name) {
  const spec = SKILLS[name];
  return !!spec && sourceCandidates(name, spec.pkgDir).some((p) => existsSync3(p));
}
function defaultSkillsDir() {
  return join4(homedir2(), ".claude", "skills");
}
async function installSkill(name, skillsDir) {
  const spec = SKILLS[name];
  if (!spec) {
    throw new Error(`unknown skill "${name}" \u2014 known: ${Object.keys(SKILLS).join(", ")}`);
  }
  const source = sourceCandidates(name, spec.pkgDir).find((p) => existsSync3(p));
  if (!source) {
    throw new Error(
      `could not find the bundled SKILL.md for "${name}" \u2014 it ships with a different package: npm install -g ${spec.pkg}`
    );
  }
  const content = await readFile(source, "utf8");
  const target = join4(skillsDir, name, "SKILL.md");
  if (existsSync3(target)) {
    const existing = await readFile(target, "utf8");
    if (existing === content) return { name, target, status: "already-current" };
    await writeFile(target, content, "utf8");
    return { name, target, status: "updated" };
  }
  await mkdir(dirname2(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { name, target, status: "installed" };
}

// src/shared/agent-notices.js
var AGENT_CONFIG_URL = process.env.FLOW_BEHIND_CONFIG_URL || "https://flow-connector.flowconnector.workers.dev/config.json";
var AgentNoticeSchema = external_exports.object({
  id: external_exports.string().min(1).max(64),
  /** "all", "image", "video", or one flow-* mode name. */
  area: external_exports.string().min(1).max(40),
  state: external_exports.enum(["problem", "fixing", "info"]),
  text: external_exports.string().min(1).max(300)
});
var AgentConfigSchema = external_exports.object({
  /** The newest CLI on npm. Lets an update be announced in minutes, not at the next npm poll. */
  latest: external_exports.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  notices: external_exports.array(AgentNoticeSchema).max(10).optional()
});
function agentConfigOf(raw) {
  const parsed = AgentConfigSchema.safeParse(raw?.agent);
  return parsed.success ? parsed.data : {};
}
var LABEL = {
  problem: "known problem",
  fixing: "being fixed",
  info: "notice"
};
function noticeLine(n) {
  return `${LABEL[n.state]} [${n.area}]: ${n.text}`;
}

// src/commands/update.js
import { execFileSync } from "child_process";
import { existsSync as existsSync6, mkdirSync as mkdirSync5, readFileSync as readFileSync3, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname3, join as join7 } from "path";
var FILE2 = join7(STATE_DIR, "update.json");
var CHECK_EVERY_MS = 12 * 36e5;
var CONFIG_EVERY_MS = 5 * 6e4;
var REPEAT_NOTICE_MS = 36e5;
var CONFIG_PACKAGE = BRAND.package;
function read() {
  try {
    return JSON.parse(readFileSync3(FILE2, "utf8"));
  } catch {
    return {};
  }
}
function write(s) {
  try {
    mkdirSync5(dirname3(FILE2), { recursive: true });
    writeFileSync4(FILE2, JSON.stringify(s));
  } catch {
  }
}
function updateLine(pkg, have, latest) {
  if (!latest || versionAtLeast(have, latest)) return null;
  return `update available: ${pkg} ${latest} (you have ${have}) \u2014 run: npm install -g ${pkg}@latest`;
}
function rememberSkillDir(dir) {
  const s = read();
  if (dir === defaultSkillsDir() || s.skillDirs?.includes(dir)) return;
  write({ ...s, skillDirs: [...s.skillDirs ?? [], dir] });
}
async function syncSkills(s, version, log) {
  if (s.skillsSyncedFor === version) return;
  for (const dir of /* @__PURE__ */ new Set([defaultSkillsDir(), ...s.skillDirs ?? []])) {
    for (const name of Object.keys(SKILLS)) {
      if (!isBundled(name) || !existsSync6(join7(dir, name, "SKILL.md"))) continue;
      const r = await installSkill(name, dir).catch(() => null);
      if (r?.status === "updated") {
        log(`skill ${name} updated to match ${version} \u2014 start a new agent session to load it`);
      }
    }
  }
  s.skillsSyncedFor = version;
}
async function checkNpm(s, pkg) {
  if (!process.env.FLOW_BEHIND_UPDATE_PACKAGE) return;
  pkg = process.env.FLOW_BEHIND_UPDATE_PACKAGE;
  if (Date.now() - (s.checkedAt ?? 0) < CHECK_EVERY_MS) return;
  s.checkedAt = Date.now();
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: AbortSignal.timeout(2e3) });
    if (res.ok) s.latest = (await res.json()).version;
  } catch {
  }
}
async function checkConfig(s, pkg) {
  if (pkg !== CONFIG_PACKAGE || Date.now() - (s.configAt ?? 0) < CONFIG_EVERY_MS) return;
  s.configAt = Date.now();
  try {
    const res = await fetch(AGENT_CONFIG_URL, { signal: AbortSignal.timeout(2e3) });
    if (res.ok) {
      s.agent = agentConfigOf(await res.json());
      if (!process.env.FLOW_BEHIND_CONFIG_URL) delete s.agent.latest;
    }
  } catch {
  }
}
function newest(a, b) {
  if (!a || !b) return a ?? b;
  return versionAtLeast(a, b) ? a : b;
}
function dueNotices(s, hears, now) {
  if (hears === "never") return [];
  const due = (s.agent?.notices ?? []).filter(
    (n) => hears === "always" || now - (s.shown?.[n.id] ?? 0) >= REPEAT_NOTICE_MS
  );
  if (hears === "hourly") for (const n of due) s.shown = { ...s.shown, [n.id]: now };
  return due.map(noticeLine);
}
function pidFromNetstat(out, port) {
  const line = out.split(/\r?\n/).find((l) => /LISTENING/i.test(l) && new RegExp(`:${port}\\s`).test(l));
  const pid = Number(line?.trim().split(/\s+/).pop());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
function pidOnPort(port) {
  try {
    if (process.platform === "win32") {
      return pidFromNetstat(execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }), port);
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return Number(out.trim().split("\n")[0]) || null;
  } catch {
    return null;
  }
}
async function replaceStaleBridge(port, mine, log) {
  const status = async (site) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status?site=${site}`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const flow = await status("flow");
  if (flow?.bridgeProduct !== BRAND.package) return;
  const running = flow?.bridgeVersion;
  if (!running || running === mine || !versionAtLeast(mine, running)) return;
  if ((flow.activeJobs ?? 0) + ((await status("grok"))?.activeJobs ?? 0) > 0) return;
  const pid = pidOnPort(port);
  if (!pid) return;
  try {
    process.kill(pid);
    await new Promise((r) => setTimeout(r, 500));
    log(`restarted the background helper (was ${running}, now ${mine})`);
  } catch {
  }
}
async function keepCurrent(pkg, version, port, hears = "never", log = console.error) {
  try {
    const s = read();
    await syncSkills(s, version, log);
    await Promise.all([checkNpm(s, pkg), checkConfig(s, pkg)]);
    const notices = dueNotices(s, hears, Date.now());
    write(s);
    await replaceStaleBridge(port, version, log);
    const line = updateLine(process.env.FLOW_BEHIND_UPDATE_PACKAGE || pkg, version, newest(s.latest, s.agent?.latest));
    if (line) log(line);
    for (const n of notices) log(n);
  } catch {
  }
}

// src/bridge/job-store.js
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync as readFileSync2, writeFileSync, renameSync } from "node:fs";
import { join as join2 } from "node:path";
var FILE = join2(STATE_DIR, "jobs.json");
var KEEP = 200;
var STALE_WAIT_MS = 30 * 6e4;
var TERMINAL = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
var IN_FLIGHT = /* @__PURE__ */ new Set(["running", "queued", "waiting_for_extension", "downloading"]);
var jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);
var jobs = [];
function loadJobs() {
  try {
    const saved = JSON.parse(readFileSync2(FILE, "utf8"));
    jobs = Array.isArray(saved) ? saved : [];
    for (const job of jobs) {
      if (!IN_FLIGHT.has(job.status)) continue;
      job.status = "failed";
      job.error = "bridge restarted while job was in flight";
    }
  } catch {
    jobs = [];
  }
}
function persist() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const temporary = `${FILE}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(jobs.slice(-KEEP), null, 2));
    renameSync(temporary, FILE);
  } catch (error) {
    console.error(`[Flow Behind] Could not save job history: ${error.message}`);
  }
}
function addJob(job) {
  jobs.push(job);
  persist();
  jobEvents.emit("change", job);
}
function getJob(id) {
  return jobs.find((job) => job.id === id);
}
function listJobs() {
  return [...jobs].reverse();
}
function pendingJobs() {
  return jobs.filter((job) => job.status === "waiting_for_extension");
}
function updateJob(id, patch) {
  const job = getJob(id);
  if (!job) return void 0;
  Object.assign(job, patch, { updatedAt: Date.now() });
  persist();
  jobEvents.emit("change", job);
  return job;
}
function clearFinished(site) {
  const before = jobs.length;
  jobs = jobs.filter((job) => siteForMode(job.mode) !== site || !TERMINAL.has(job.status));
  const removed = before - jobs.length;
  if (removed) persist();
  return removed;
}
function markStale(all, now) {
  let count = 0;
  for (const job of all) {
    const idle = now - (job.updatedAt ?? job.createdAt ?? now);
    if (job.status !== "waiting_for_extension" || idle < STALE_WAIT_MS) continue;
    Object.assign(job, {
      status: "failed",
      stage: void 0,
      updatedAt: now,
      error: `abandoned \u2014 no extension picked this up for ${Math.round(idle / 6e4)} min (stale queue entry from an earlier run)`
    });
    count++;
    jobEvents.emit("change", job);
  }
  return count;
}
function expireStale() {
  const count = markStale(jobs, Date.now());
  if (count) persist();
  return count;
}
function pickOrphans(all, site, claimed) {
  if (!claimed) return [];
  const live = new Set(claimed);
  return all.filter((job) => siteForMode(job.mode) === site && (job.status === "running" || job.status === "downloading") && !live.has(job.id));
}
function orphanedJobs(site, claimed) {
  return pickOrphans(jobs, site, claimed);
}
function waitForJob(id, timeoutMs) {
  const job = getJob(id);
  if (!job || TERMINAL.has(job.status)) return Promise.resolve(job);
  return new Promise((resolve3) => {
    const finish = (value) => {
      clearTimeout(timer);
      jobEvents.off("change", onChange);
      resolve3(value);
    };
    const onChange = (changed) => {
      if (changed.id === id && TERMINAL.has(changed.status)) finish(changed);
    };
    const timer = setTimeout(() => finish(getJob(id)), timeoutMs);
    jobEvents.on("change", onChange);
  });
}

// src/bridge/file-service.js
import { randomUUID } from "crypto";
import { statSync, createReadStream } from "fs";
import { basename as basename2, extname } from "path";
var TTL_MS = 30 * 6e4;
var tokens = /* @__PURE__ */ new Map();
var MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp"
};
function registerFile(path) {
  const ext = extname(path).toLowerCase();
  if (!(ext in MIME)) {
    throw new Error(
      `unsupported input type "${ext || "none"}" \u2014 images (${Object.keys(MIME).filter((e) => MIME[e].startsWith("image/")).join(" ")}) and video (${Object.keys(MIME).filter((e) => MIME[e].startsWith("video/")).join(" ")}) only`
    );
  }
  const stat = statSync(path);
  const meta = {
    token: randomUUID(),
    name: basename2(path),
    mime: MIME[ext] ?? "application/octet-stream",
    size: stat.size
  };
  tokens.set(meta.token, { path, meta, expiresAt: Date.now() + TTL_MS });
  return meta;
}
function serveFile(token, res) {
  const rec = tokens.get(token);
  if (!rec || rec.expiresAt < Date.now()) {
    res.writeHead(404).end("unknown or expired token");
    return;
  }
  res.writeHead(200, {
    "content-type": rec.meta.mime,
    "content-length": rec.meta.size
  });
  createReadStream(rec.path).pipe(res);
}
function sweepExpiredTokens() {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
}

// src/bridge/server.js
import { createServer } from "http";
import { randomUUID as randomUUID2 } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
var BRIDGE_VERSION = BRAND.version;
var TAKEOVER_WINDOW_MS = 6e4;
var TAKEOVER_FIGHT = 3;
function freshExtState() {
  return {
    ws: null,
    extVersion: null,
    loggedIn: null,
    plan: null,
    usedToday: null,
    dailyLimit: null,
    usage: null,
    limits: null,
    pausedReason: null,
    activeJobs: 0,
    grokVisible: null,
    flowLayout: null,
    flowAccess: null,
    cooldownUntil: null,
    lastWarning: null,
    browser: null,
    takeovers: []
  };
}
var extensions = /* @__PURE__ */ new Map();
function getExt(site) {
  let state = extensions.get(site);
  if (!state) {
    state = freshExtState();
    extensions.set(site, state);
  }
  return state;
}
var wsSite = /* @__PURE__ */ new WeakMap();
var jobFiles = /* @__PURE__ */ new Map();
function sendToExt(site, msg) {
  const ws = getExt(site).ws;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}
function dispatchJob(job) {
  const inputFiles = jobFiles.get(job.id) ?? [];
  const sent = sendToExt(siteForMode(job.mode), {
    t: "job.submit",
    jobId: job.id,
    // Send the whole job, not a hand-listed subset: the receiving end parses
    // it with JobSpecSchema, which strips the queue-only fields anyway. This
    // list silently dropped batchIndex once and assetRefs again — every new
    // JobSpec field was a fresh bug until someone remembered to add it here.
    job,
    inputFiles
  });
  updateJob(job.id, { status: sent ? "queued" : "waiting_for_extension" });
}
function flushPending() {
  for (const job of pendingJobs()) dispatchJob(job);
}
function handleExtMessage(raw, ws) {
  const parsed = ExtToBridgeSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.warn("[bridge] bad ext message:", parsed.error.message);
    return;
  }
  const msg = parsed.data;
  switch (msg.t) {
    case "ext.hello": {
      const state = getExt(msg.site);
      if (state.ws && state.ws !== ws) {
        const score = (visible, tab) => (visible ? 2 : 0) + (tab ? 1 : 0);
        const incumbent = score(state.grokVisible, state.flowLayout !== null || state.flowAccess !== null);
        const newcomer = score(msg.flowVisible, msg.flowTab ?? true);
        if (msg.browser !== state.browser && newcomer <= incumbent) {
          console.log(`[bridge] ${msg.site}: keeping ${state.browser}, ${msg.browser ?? "?"} put on standby`);
          ws.close(4001, "standby");
          break;
        }
        state.ws.close(4001, "standby");
        const now = Date.now();
        state.takeovers = [...state.takeovers.filter((t) => now - t < TAKEOVER_WINDOW_MS), now];
      }
      wsSite.set(ws, msg.site);
      state.ws = ws;
      state.extVersion = msg.extVersion;
      state.loggedIn = msg.loggedIn;
      state.plan = msg.plan;
      state.browser = msg.browser ?? null;
      console.log(
        `[bridge] ${msg.site} extension connected (v${msg.extVersion}, loggedIn=${msg.loggedIn}, browser=${msg.browser ?? "?"})`
      );
      for (const job of orphanedJobs(msg.site, msg.runningJobIds)) {
        console.log(`[bridge] reclaiming ${job.id} \u2014 left running by a previous extension instance`);
        updateJob(job.id, { status: "waiting_for_extension", stage: void 0 });
      }
      flushPending();
      break;
    }
    case "ext.status": {
      const site = wsSite.get(ws);
      if (!site) break;
      const state = getExt(site);
      state.loggedIn = msg.loggedIn;
      state.plan = msg.plan;
      state.usedToday = msg.usedToday;
      state.dailyLimit = msg.dailyLimit;
      state.usage = msg.usage ?? null;
      state.limits = msg.limits ?? null;
      state.pausedReason = msg.pausedReason ?? null;
      state.activeJobs = msg.activeJobs;
      state.grokVisible = msg.grokVisible ?? null;
      state.flowLayout = msg.flowLayout ?? null;
      state.flowAccess = msg.flowAccess ?? null;
      state.cooldownUntil = msg.cooldownUntil ?? null;
      state.lastWarning = msg.lastWarning ?? null;
      state.browser = msg.browser ?? state.browser;
      break;
    }
    case "ext.heartbeat":
      break;
    // A job the user stopped stays stopped: a late accept/progress from the
    // extension used to flip it back to "running", and the next reconnect then
    // re-dispatched it as an orphan — a cancelled character got built anyway.
    case "job.accepted":
      if (getJob(msg.jobId)?.status !== "cancelled") updateJob(msg.jobId, { status: "running" });
      break;
    case "job.progress":
      if (getJob(msg.jobId)?.status !== "cancelled") {
        updateJob(msg.jobId, { stage: msg.stage, status: "running" });
      }
      break;
    case "job.result":
      if (getJob(msg.jobId)?.status === "cancelled") break;
      updateJob(msg.jobId, { status: "done", files: msg.files, stage: void 0, error: msg.warning });
      jobFiles.delete(msg.jobId);
      break;
    case "job.failed":
      if (getJob(msg.jobId)?.status === "cancelled") break;
      updateJob(msg.jobId, {
        status: "failed",
        error: msg.reason,
        retryable: msg.retryable,
        stage: void 0
      });
      jobFiles.delete(msg.jobId);
      break;
    case "healthcheck.result": {
      console.log(
        `[bridge] healthcheck: ${msg.entries.filter((e) => e.matched).length}/${msg.entries.length} matched`
      );
      const site = wsSite.get(ws);
      if (!site) break;
      const waiters = healthcheckWaiters.get(site) ?? [];
      healthcheckWaiters.set(site, []);
      for (const w of waiters) w({ entries: msg.entries, diagnostics: msg.diagnostics });
      break;
    }
    case "dom.result": {
      const site = wsSite.get(ws);
      if (!site) break;
      const waiters = domWaiters.get(site) ?? [];
      domWaiters.set(site, []);
      for (const w of waiters) w(msg.items);
      break;
    }
    case "logs.result": {
      const site = wsSite.get(ws);
      if (!site) break;
      const waiters = logsWaiters.get(site) ?? [];
      logsWaiters.set(site, []);
      for (const w of waiters) w(msg.entries);
      break;
    }
  }
}
var logsWaiters = /* @__PURE__ */ new Map();
var domWaiters = /* @__PURE__ */ new Map();
function fetchExtDom(site, selector, clickFirst) {
  return new Promise((resolve3) => {
    if (!sendToExt(site, { t: "dom.query", selector, clickFirst })) return resolve3([]);
    const waiter = (items) => {
      clearTimeout(timer);
      domWaiters.set(site, (domWaiters.get(site) ?? []).filter((w) => w !== waiter));
      resolve3(items);
    };
    const timer = setTimeout(() => waiter([]), 15e3);
    domWaiters.set(site, [...domWaiters.get(site) ?? [], waiter]);
  });
}
function fetchExtLogs(site, timeoutMs = 5e3) {
  return new Promise((resolve3) => {
    if (!sendToExt(site, { t: "logs.query" })) return resolve3([]);
    const timer = setTimeout(() => {
      logsWaiters.set(site, (logsWaiters.get(site) ?? []).filter((w) => w !== waiter));
      resolve3([]);
    }, timeoutMs);
    const waiter = (entries) => {
      clearTimeout(timer);
      resolve3(entries);
    };
    logsWaiters.set(site, [...logsWaiters.get(site) ?? [], waiter]);
  });
}
var healthcheckWaiters = /* @__PURE__ */ new Map();
function fetchHealthcheck(site, timeoutMs = 8e3) {
  return new Promise((resolve3) => {
    const empty = { entries: [] };
    if (!sendToExt(site, { t: "healthcheck.run" })) return resolve3(empty);
    const timer = setTimeout(() => {
      healthcheckWaiters.set(site, (healthcheckWaiters.get(site) ?? []).filter((w) => w !== waiter));
      resolve3(empty);
    }, timeoutMs);
    const waiter = (result) => {
      clearTimeout(timer);
      resolve3(result);
    };
    healthcheckWaiters.set(site, [...healthcheckWaiters.get(site) ?? [], waiter]);
  });
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function originAllowed(origin) {
  if (!origin) return true;
  return origin.startsWith("chrome-extension://");
}
function hostIsLoopback(req) {
  const host = ((req.headers.host ?? "").split(":")[0] ?? "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "";
}
async function handleHttp(req, res) {
  const url = new URL(req.url ?? "/", `http://${BRIDGE_HOST}`);
  const path = url.pathname;
  const origin = req.headers.origin;
  if (!hostIsLoopback(req) || !originAllowed(origin)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
    return;
  }
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }
  const expired = expireStale();
  if (expired > 0) console.log(`[bridge] expired ${expired} stale job(s) left by an earlier run`);
  try {
    if (req.method === "GET" && path === "/status") {
      const site = url.searchParams.get("site") ?? "grok";
      const state = getExt(site);
      const status = {
        bridge: "up",
        bridgeProduct: BRAND.package,
        bridgePid: process.pid,
        bridgeVersion: BRIDGE_VERSION,
        extensionConnected: state.ws?.readyState === WebSocket.OPEN,
        extensionVersion: state.extVersion ?? void 0,
        loggedIn: state.loggedIn,
        plan: state.plan,
        usedToday: state.usedToday,
        dailyLimit: state.dailyLimit,
        usage: state.usage ?? void 0,
        limits: state.limits ?? void 0,
        pausedReason: state.pausedReason,
        activeJobs: state.activeJobs,
        grokVisible: state.grokVisible,
        flowLayout: state.flowLayout,
        flowAccess: state.flowAccess,
        cooldownUntil: state.cooldownUntil,
        lastWarning: state.lastWarning,
        browser: state.browser ?? void 0,
        duplicateInstalls: state.takeovers.filter((t) => Date.now() - t < TAKEOVER_WINDOW_MS).length >= TAKEOVER_FIGHT
      };
      sendToExt(site, { t: "status.query" });
      return json(res, 200, status);
    }
    if (req.method === "POST" && path === "/jobs") {
      const body = SubmitJobRequestSchema.safeParse(JSON.parse(await readBody(req)));
      if (!body.success) return json(res, 400, { error: body.error.message });
      let files;
      try {
        files = body.data.imagePaths.map(registerFile);
      } catch (e) {
        return json(res, 400, { error: `image path: ${e instanceof Error ? e.message : e}` });
      }
      const limits = MODE_LIMITS[body.data.job.mode];
      const refCount = files.length + (body.data.job.assetRefs?.length ?? 0);
      const tooMany = tooManyReferences(body.data.job.mode, body.data.job.params.imageModel, refCount);
      if (tooMany) return json(res, 400, { error: tooMany });
      const extVersion = getExt(siteForMode(body.data.job.mode)).extVersion;
      if (body.data.job.mode === "flow-ingredients-to-video" && refCount > VEO_INGREDIENTS_MAX && !versionAtLeast(extVersion, MANY_INGREDIENTS_EXT)) {
        return json(res, 400, {
          error: `more than ${VEO_INGREDIENTS_MAX} ingredients needs Flow Connector extension ${MANY_INGREDIENTS_EXT} or newer (${extVersion ? `yours is ${extVersion}` : "none is connected"}) \u2014 an older one would quietly drop the rest. Update the extension, or pass ${VEO_INGREDIENTS_MAX} references.`
        });
      }
      if (body.data.job.params.outputsPerPrompt > limits.maxOutputs) {
        return json(res, 400, {
          error: `${body.data.job.mode} allows at most ${limits.maxOutputs} output(s) per prompt`
        });
      }
      const now = Date.now();
      const job = {
        ...body.data.job,
        inputImages: files.map((f) => ({
          id: f.token,
          name: f.name,
          mime: f.mime,
          source: "bridge-token"
        })),
        id: randomUUID2(),
        status: "waiting_for_extension",
        source: "bridge",
        client: body.data.client,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        maxRetries: 3,
        files: []
      };
      jobFiles.set(job.id, files);
      addJob(job);
      dispatchJob(job);
      return json(res, 200, { jobId: job.id });
    }
    if (req.method === "GET" && path === "/jobs") {
      return json(res, 200, { jobs: listJobs() });
    }
    if (req.method === "POST" && path === "/reload-extension") {
      const site = url.searchParams.get("site") ?? "grok";
      const delivered = sendToExt(site, { t: "ext.reload" });
      return json(res, 200, { delivered });
    }
    if (req.method === "POST" && path === "/stop") {
      const site = url.searchParams.get("site") ?? "grok";
      const delivered = sendToExt(site, { t: "queue.stop" });
      let cancelled = 0;
      for (const job of listJobs()) {
        if (siteForMode(job.mode) !== site) continue;
        if (job.status === "done" || job.status === "failed" || job.status === "cancelled") continue;
        updateJob(job.id, { status: "cancelled", stage: void 0, error: "stopped by user" });
        cancelled++;
      }
      return json(res, 200, { delivered, cancelled });
    }
    if (req.method === "POST" && path === "/queue/clear") {
      const site = url.searchParams.get("site") ?? "grok";
      const delivered = sendToExt(site, { t: "queue.clear" });
      const removed = clearFinished(site);
      return json(res, 200, { delivered, removed });
    }
    if (req.method === "GET" && path === "/dom") {
      const site = url.searchParams.get("site") ?? "grok";
      const items = await fetchExtDom(
        site,
        url.searchParams.get("selector") ?? void 0,
        url.searchParams.get("click") ?? void 0
      );
      return json(res, 200, { items });
    }
    if (req.method === "GET" && path === "/logs") {
      const site = url.searchParams.get("site") ?? "grok";
      return json(res, 200, { entries: await fetchExtLogs(site) });
    }
    if (req.method === "GET" && path === "/healthcheck") {
      const site = url.searchParams.get("site") ?? "grok";
      return json(res, 200, await fetchHealthcheck(site));
    }
    const jobMatch = /^\/jobs\/([\w-]+)(\/wait|\/cancel)?$/.exec(path);
    if (jobMatch) {
      const [, id, action] = jobMatch;
      if (req.method === "GET" && !action) {
        const job = getJob(id);
        return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
      }
      if (req.method === "GET" && action === "/wait") {
        const timeoutMs = Math.min(Number(url.searchParams.get("timeoutMs") ?? 6e5), 36e5);
        const job = await waitForJob(id, timeoutMs);
        return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && action === "/cancel") {
        const existing = getJob(id);
        if (existing) sendToExt(siteForMode(existing.mode), { t: "job.cancel", jobId: id });
        const job = updateJob(id, { status: "cancelled" });
        return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
      }
    }
    const fileMatch = /^\/files\/([\w-]+)$/.exec(path);
    if (req.method === "GET" && fileMatch) {
      return serveFile(fileMatch[1], res);
    }
    json(res, 404, { error: "unknown route" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}
function startBridgeServer(port) {
  loadJobs();
  const server = createServer((req, res) => void handleHttp(req, res));
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin, req }) => originAllowed(origin) && hostIsLoopback(req)
  });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ t: "bridge.hello", bridgeVersion: BRIDGE_VERSION }));
    ws.on("message", (data) => {
      try {
        handleExtMessage(String(data), ws);
      } catch (e) {
        console.warn("[bridge] message error:", e);
      }
    });
    ws.on("close", () => {
      const site = wsSite.get(ws);
      if (site && getExt(site).ws === ws) {
        getExt(site).ws = null;
        wsSite.delete(ws);
        console.log(`[bridge] ${site} extension disconnected`);
      }
    });
  });
  setInterval(sweepExpiredTokens, 6e4).unref();
  return new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(port, BRIDGE_HOST, () => {
      console.log(`[bridge] listening on http://${BRIDGE_HOST}:${port} (ws: /ws)`);
      resolve3();
    });
  });
}

// src/commands/merge.js
import { spawn as spawn2, spawnSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, readdirSync } from "fs";
import { tmpdir } from "os";
import { dirname as dirname4, join as join22, resolve as resolve2 } from "path";
function resolveFfmpeg() {
  const onPath = (bin) => {
    try {
      const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
      return r.status === 0 || r.status === 1;
    } catch {
      return false;
    }
  };
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    const dir = process.env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, "");
    const probe3 = join22(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    return { ffmpeg: process.env.FFMPEG_PATH, ffprobe: existsSync(probe3) ? probe3 : "ffprobe" };
  }
  if (onPath("ffmpeg")) return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
  const local = process.env.LOCALAPPDATA;
  if (local && process.platform === "win32") {
    const pkgRoot = join22(local, "Microsoft", "WinGet", "Packages");
    try {
      const gyan = readdirSync(pkgRoot).find((d) => /^Gyan\.FFmpeg/i.test(d));
      if (gyan) {
        const buildDir = readdirSync(join22(pkgRoot, gyan)).find((d) => /^ffmpeg-.*build$/i.test(d));
        if (buildDir) {
          const bin = join22(pkgRoot, gyan, buildDir, "bin");
          const ff = join22(bin, "ffmpeg.exe");
          const fp = join22(bin, "ffprobe.exe");
          if (existsSync(ff)) return { ffmpeg: ff, ffprobe: existsSync(fp) ? fp : "ffprobe" };
        }
      }
    } catch {
    }
  }
  return null;
}
function probe(ffprobe, input) {
  const r = spawnSync(
    ffprobe,
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", input],
    { encoding: "utf8" }
  );
  let width = 0, height = 0, hasAudio = false;
  try {
    const j = JSON.parse(r.stdout);
    for (const s of j.streams ?? []) {
      if (s.codec_type === "video") {
        width = Number(s.width) || width;
        height = Number(s.height) || height;
      }
      if (s.codec_type === "audio") hasAudio = true;
    }
  } catch {
  }
  return { width, height, hasAudio };
}
function run(bin, args) {
  return new Promise((res) => {
    const p = spawn2(bin, args);
    let stderr = "";
    p.stderr.on("data", (d) => stderr += String(d));
    p.on("error", (e) => res({ ok: false, stderr: String(e) }));
    p.on("close", (code) => res({ ok: code === 0, stderr }));
  });
}
async function mergeVideos(inputsRaw, outputRaw, tools, opts = {}) {
  const inputs = inputsRaw.map((p) => resolve2(p));
  const output = resolve2(outputRaw);
  for (const i of inputs) if (!existsSync(i)) throw new Error(`input not found: ${i}`);
  if (inputs.length < 2) throw new Error("need at least 2 videos to merge");
  mkdirSync2(dirname4(output), { recursive: true });
  if (opts.fast) {
    const tmp = mkdtempSync(join22(tmpdir(), "flow-behind-merge-"));
    const listFile = join22(tmp, "list.txt");
    writeFileSync2(
      listFile,
      inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8"
    );
    const copy = await run(tools.ffmpeg, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      output
    ]);
    if (copy.ok && existsSync(output)) return { output, method: "copy", inputs: inputs.length };
  }
  const probes = inputs.map((i) => probe(tools.ffprobe, i));
  const W = Math.max(...probes.map((p) => p.width || 0)) || 1280;
  const H = Math.max(...probes.map((p) => p.height || 0)) || 720;
  const allAudio = probes.every((p) => p.hasAudio);
  const args = ["-y"];
  for (const i of inputs) args.push("-i", i);
  const parts = [];
  const streams = [];
  inputs.forEach((_, idx) => {
    parts.push(
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${idx}]`
    );
    streams.push(`[v${idx}]`);
    if (allAudio) streams.push(`[${idx}:a]`);
  });
  const concat = `${streams.join("")}concat=n=${inputs.length}:v=1:a=${allAudio ? 1 : 0}[outv]${allAudio ? "[outa]" : ""}`;
  args.push("-filter_complex", `${parts.join(";")};${concat}`);
  args.push("-map", "[outv]");
  if (allAudio) args.push("-map", "[outa]");
  args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  if (allAudio) args.push("-c:a", "aac", "-b:a", "192k");
  args.push(output);
  const re = await run(tools.ffmpeg, args);
  if (!re.ok || !existsSync(output)) {
    throw new Error(`ffmpeg merge failed:
${re.stderr.split("\n").slice(-8).join("\n")}`);
  }
  return { output, method: "reencode", inputs: inputs.length };
}

// src/commands/doctor.js
import { existsSync as existsSync5 } from "fs";
import { join as join6 } from "path";
var MIN_NODE_MAJOR = 20;
function checkNode(version) {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  if (major >= MIN_NODE_MAJOR) return { name: "Node.js", state: "ok", detail: version };
  return {
    name: "Node.js",
    state: "fail",
    detail: `${version} \u2014 too old, this needs ${MIN_NODE_MAJOR} or newer`,
    fix: "Install the current LTS from https://nodejs.org, then open a NEW terminal \u2014 the one you are in will not see it."
  };
}
function checkBridge(status, cliBridgeVersion) {
  if (!status) {
    return {
      name: "Bridge",
      state: "fail",
      detail: "not running",
      fix: "It starts itself on the next generate. If it never comes up, something is holding port 8791."
    };
  }
  if (status.bridgeVersion !== cliBridgeVersion) {
    return {
      name: "Bridge",
      state: "fail",
      detail: `running v${status.bridgeVersion}, this CLI ships v${cliBridgeVersion}`,
      fix: "A daemon from an older install is still running and serving its own code. Stop it (end the `node ... bridge start` process) and re-run any command to start the current one."
    };
  }
  return { name: "Bridge", state: "ok", detail: `up (v${status.bridgeVersion})` };
}
function checkExtension(status, site) {
  const label = site === "flow" ? "Flow Connector" : "Grok Imagine Connector";
  if (!status || !status.extensionConnected) {
    return {
      name: "Extension",
      state: "fail",
      detail: "not connected",
      fix: `Open the browser where ${label} is installed, check it is enabled at chrome://extensions, and open a ${site === "flow" ? "flow.google.com" : "grok.com/imagine"} tab.`
    };
  }
  return {
    name: "Extension",
    state: "ok",
    detail: status.extensionVersion ? `connected (v${status.extensionVersion})` : "connected"
  };
}
function checkLoggedIn(status, site) {
  if (!status?.extensionConnected) return null;
  if (status.loggedIn === false) {
    return {
      name: "Signed in",
      state: "fail",
      detail: "not signed in",
      fix: `Sign in to ${site === "flow" ? "Google, on flow.google.com" : "grok.com"} in that browser window.`
    };
  }
  return { name: "Signed in", state: "ok", detail: "yes" };
}
function checkTabVisible(status, site) {
  if (!status?.extensionConnected) return null;
  if (status.grokVisible === false) {
    return {
      name: "Tab visible",
      state: "fail",
      detail: "the tab is open but hidden or minimised",
      fix: "Bring that window to the front and leave it there \u2014 side by side with your editor, or on a second screen. Chrome throttles hidden tabs and generation stalls."
    };
  }
  if (status.grokVisible === null) {
    return {
      name: "Tab visible",
      state: "warn",
      detail: "no tab reported",
      fix: `Open ${site === "flow" ? "flow.google.com" : "grok.com/imagine"} in that browser.`
    };
  }
  return { name: "Tab visible", state: "ok", detail: "yes" };
}
function checkSingleInstall(status) {
  if (!status?.extensionConnected || !status.duplicateInstalls) return null;
  return {
    name: "One browser",
    state: "fail",
    detail: "TWO \u2014 the extension is open in two browsers or profiles",
    fix: "Keep it in ONE browser: turn Flow Connector off in the other one (chrome://extensions or edge://extensions)."
  };
}
function checkAccess(status) {
  if (!status?.extensionConnected || !status.flowAccess) return null;
  if (status.flowAccess === "blocked") {
    return {
      name: "Flow access",
      state: "fail",
      detail: "BLOCKED \u2014 the browser will not run the extension on Flow",
      fix: "Flow tab \u2192 puzzle icon (Extensions) \u2192 allow on this site; Manage extensions \u2192 Flow Connector \u2192 Details \u2192 Site access \u2192 turn on flow.google.com; reload the Flow tab."
    };
  }
  return { name: "Flow access", state: "ok", detail: "allowed" };
}
function checkLayout(status) {
  if (!status?.extensionConnected || !status.flowLayout) return null;
  if (status.flowLayout === "narrow") {
    return {
      name: "Window width",
      state: "warn",
      detail: "NARROW \u2014 Flow is in its mobile layout",
      fix: "Maximise the Flow window before any character or voice work: the Characters entry and the voice performance field do not exist at this width."
    };
  }
  return { name: "Window width", state: "ok", detail: "wide \u2014 character work available" };
}
function checkPlan(status) {
  if (!status?.extensionConnected) return null;
  const plan = status.plan ?? "unknown";
  if (status.usage && status.limits && !isUnlimitedDaily(status.dailyLimit)) {
    const { usage, limits } = status;
    const spent = usage.video >= limits.video || usage.image >= limits.image;
    return {
      name: "Plan",
      state: spent ? "warn" : "ok",
      detail: `${plan} \u2014 ${usage.video}/${limits.video} videos, ${usage.image}/${limits.image} images today`,
      fix: spent ? "Today's free allowance is spent. It resets at midnight, or Pro removes the limit." : void 0
    };
  }
  return { name: "Plan", state: "ok", detail: `${plan} (${status.usedToday ?? 0} generated today)` };
}
function checkQueue(status) {
  if (!status?.extensionConnected || !status.pausedReason) return null;
  return {
    name: "Queue",
    state: "fail",
    detail: "PAUSED",
    fix: status.pausedReason
  };
}
function checkCooldown(status, now = Date.now()) {
  const until = status?.cooldownUntil;
  if (!until || until <= now) return null;
  return {
    name: "Cooldown",
    state: "warn",
    detail: `active until ${new Date(until).toLocaleTimeString()} (${status?.lastWarning ?? "anti-bot warning"})`,
    fix: "Wait it out. Do not retry in a loop \u2014 that is what lengthens it."
  };
}
function checkFfmpeg(found, platform) {
  if (found) return { name: "ffmpeg", state: "ok", detail: "found" };
  const how = platform === "win32" ? "winget install Gyan.FFmpeg" : platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg (or your distribution's equivalent)";
  return {
    name: "ffmpeg",
    state: "warn",
    detail: "not found",
    fix: `Only needed for \`merge\` and \`clean\`; generation works without it. Install with ${how}, or set FFMPEG_PATH.`
  };
}
function checkSkill(installed, skillName, program2) {
  if (installed) return { name: "Agent skill", state: "ok", detail: `${skillName} installed` };
  return {
    name: "Agent skill",
    state: "warn",
    detail: `${skillName} not installed`,
    fix: `Only Claude Code uses this; other agents use the MCP server instead. Install it with \`${program2} skill install ${skillName}\`.`
  };
}
function runChecks(input) {
  const { status, site } = input;
  return [
    checkNode(input.nodeVersion),
    checkBridge(status, input.cliBridgeVersion),
    checkExtension(status, site),
    checkLoggedIn(status, site),
    checkTabVisible(status, site),
    checkSingleInstall(status),
    checkAccess(status),
    checkLayout(status),
    checkPlan(status),
    checkQueue(status),
    checkCooldown(status, input.now),
    checkFfmpeg(input.ffmpegFound, input.platform),
    checkSkill(input.skillInstalled, input.skillName, input.program)
  ].filter((c) => c !== null);
}
function anyFailed(checks) {
  return checks.some((c) => c.state === "fail");
}
function ffmpegPresent() {
  try {
    return resolveFfmpeg() !== null;
  } catch {
    return false;
  }
}
function skillPresent(name) {
  try {
    return existsSync5(join6(defaultSkillsDir(), name, "SKILL.md"));
  } catch {
    return false;
  }
}
var MARK = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
function format(checks) {
  const width = Math.max(...checks.map((c) => c.name.length));
  const out = [];
  for (const c of checks) {
    out.push(`${MARK[c.state]}  ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.fix) out.push(`      ${" ".repeat(width)}  -> ${c.fix}`);
  }
  const failed = checks.filter((c) => c.state === "fail");
  const warned = checks.filter((c) => c.state === "warn");
  out.push("");
  if (failed.length > 0) {
    out.push(`${failed.length} thing(s) to fix before this will generate: ${failed.map((c) => c.name).join(", ")}`);
  } else if (warned.length > 0) {
    out.push(`Ready to generate. ${warned.length} warning(s), none of which block it.`);
  } else {
    out.push("Everything checks out.");
  }
  return out.join("\n");
}

// src/commands/delay.js
function parseDelay(spec, flag = "--delay") {
  if (!spec) return void 0;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*$/.exec(spec);
  if (!m) throw new Error(`bad ${flag} "${spec}" \u2014 use seconds like 12 or a range like 10-15`);
  const min = Number(m[1]);
  const max = m[2] !== void 0 ? Number(m[2]) : min;
  return { minSec: Math.min(min, max), maxSec: Math.max(min, max) };
}

// src/commands/runs.js
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync22, readdirSync as readdirSync3, statSync as statSync2, writeFileSync as writeFileSync3 } from "fs";
import { join as join5 } from "path";
var DIR2 = join5(STATE_DIR, "runs");
function safeRunName(run3) {
  return run3.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
function manifestPath(run3) {
  return join5(DIR2, `${safeRunName(run3)}.json`);
}
function readRun(run3) {
  try {
    const raw = readFileSync22(manifestPath(run3), "utf8");
    const m = JSON.parse(raw);
    return Array.isArray(m?.entries) ? m : null;
  } catch {
    return null;
  }
}
function appendToRun(run3, entry) {
  try {
    mkdirSync4(DIR2, { recursive: true });
    const existing = readRun(run3);
    const manifest = existing ?? {
      run: run3,
      createdAt: Date.now(),
      entries: []
    };
    if (entry.index !== void 0) {
      const at = manifest.entries.findIndex((e) => e.index === entry.index);
      if (at >= 0) manifest.entries.splice(at, 1);
    }
    manifest.entries.push({ ...entry, at: Date.now() });
    manifest.entries.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    writeFileSync3(manifestPath(run3), `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  } catch {
  }
}
function listRuns() {
  try {
    if (!existsSync4(DIR2)) return [];
    return readdirSync3(DIR2).filter((f) => f.endsWith(".json")).map((f) => ({ name: f.replace(/\.json$/, ""), at: statSync2(join5(DIR2, f)).mtimeMs })).sort((a, b) => b.at - a.at).map((r) => r.name);
  } catch {
    return [];
  }
}
var TERMINAL2 = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function runReport(manifest, jobs2) {
  const byId = new Map(jobs2.map((j) => [j.id, j]));
  return manifest.entries.map((e) => {
    const job = byId.get(e.jobId);
    const status = !job ? "missing" : TERMINAL2.has(job.status) ? job.status : "pending";
    return {
      index: e.index,
      prompt: e.spec.prompt,
      jobId: e.jobId,
      status,
      error: job?.error
    };
  });
}
function toResume(rows) {
  return rows.filter((r) => r.status === "failed" || r.status === "cancelled" || r.status === "missing");
}

// src/commands/failed.js
var RUN_GAP_MS = 15 * 6e4;
function failedThisRun(jobs2, all = false) {
  const scope = [];
  if (all) {
    scope.push(...jobs2);
  } else {
    const folder = jobs2.find((j) => j.params?.downloadSubfolder)?.params?.downloadSubfolder;
    if (folder) {
      scope.push(...jobs2.filter((j) => j.params?.downloadSubfolder === folder));
    } else {
      let prev = jobs2[0]?.createdAt ?? 0;
      for (const j of jobs2) {
        if (prev - (j.createdAt ?? 0) > RUN_GAP_MS) break;
        prev = j.createdAt ?? prev;
        scope.push(j);
      }
    }
  }
  const slot = (j) => j.batchIndex !== void 0 ? `${j.params?.downloadSubfolder ?? ""}#${j.batchIndex}` : `p:${j.prompt}`;
  const done = new Set(scope.filter((j) => j.status === "done").map(slot));
  const seen = /* @__PURE__ */ new Set();
  return scope.filter((j) => {
    if (j.status !== "failed") return false;
    const key = slot(j);
    if (done.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/commands/dewatermark.js
import { spawn as spawn3, spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync3, mkdtempSync as mkdtempSync2, readdirSync as readdirSync2, rmSync } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join3 } from "path";
var BOX_W_FRAC = 0.17;
var BOX_H_RATIO = 0.42;
var FLOW_BOX = {
  image: { off: 126, size: 58 },
  // sparkle ~45px, 75px inset
  video: { off: 151, size: 64 }
  // sparkle ~47px, 96px inset
};
var IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
var even = (n) => Math.max(2, Math.floor(n / 2) * 2);
function probe2(ffprobe, input) {
  const r = spawnSync2(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,r_frame_rate",
      "-of",
      "json",
      input
    ],
    { encoding: "utf8" }
  );
  let w = 0, h = 0, hasAudio = false, fps = "30";
  try {
    const j = JSON.parse(r.stdout);
    for (const s of j.streams ?? []) {
      if (s.codec_type === "video") {
        w = Number(s.width) || w;
        h = Number(s.height) || h;
        if (typeof s.r_frame_rate === "string" && s.r_frame_rate !== "0/0") fps = s.r_frame_rate;
      }
      if (s.codec_type === "audio") hasAudio = true;
    }
  } catch {
  }
  return { w, h, hasAudio, fps };
}
function parseBox(spec, w, h, mark, isImage) {
  if (spec) {
    const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(spec);
    if (!m) throw new Error(`bad --box "${spec}" (want WxH+X+Y, e.g. 200x80+1080+640)`);
    const [bw2, bh2, bx, by] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (bx + bw2 > w || by + bh2 > h) {
      throw new Error(`box ${bw2}x${bh2}+${bx}+${by} exceeds the ${w}x${h} frame`);
    }
    return { bx, by, bw: bw2, bh: bh2 };
  }
  if (mark === "flow") {
    const { off, size } = isImage ? FLOW_BOX.image : FLOW_BOX.video;
    if (off > w || off > h) {
      throw new Error(`${w}x${h} is too small for the flow mark preset; pass --box`);
    }
    return { bx: w - off, by: h - off, bw: size, bh: size };
  }
  const bw = Math.round(w * BOX_W_FRAC);
  const bh = Math.min(Math.round(bw * BOX_H_RATIO), h);
  return { bx: w - bw, by: h - bh, bw, bh };
}
function cropFilter(w, h, box, cut) {
  const rightW = box.bx;
  const rightH = Math.floor(rightW * h / w);
  const bottomH = box.by;
  const bottomW = Math.floor(bottomH * w / h);
  const chosen = cut === "auto" ? bottomH * bottomW >= rightW * rightH ? "bottom" : "right" : cut;
  let cw, ch, x, y;
  switch (chosen) {
    case "bottom":
      cw = even(bottomW);
      ch = even(bottomH);
      [x, y] = [`(${w}-${cw})/2`, "0"];
      break;
    case "center":
      ch = even(h - 2 * box.bh);
      cw = even(ch * w / h);
      [x, y] = [`(${w}-${cw})/2`, `(${h}-${ch})/2`];
      break;
    case "topleft":
      cw = even(bottomW);
      ch = even(bottomH);
      [x, y] = ["0", "0"];
      break;
    default:
      cw = even(rightW);
      ch = even(rightH);
      [x, y] = ["0", `(${h}-${ch})/2`];
  }
  return {
    vf: `crop=${cw}:${ch}:${x}:${y},scale=${w}:${h},setsar=1`,
    detail: `${chosen}-cut ${cw}x${ch} -> ${w}x${h}`
  };
}
function delogoFilter(w, h, box) {
  const x = Math.max(2, box.bx);
  const y = Math.max(2, box.by);
  const bw = Math.min(box.bw, w - x - 2);
  const bh = Math.min(box.bh, h - y - 2);
  return `delogo=x=${x}:y=${y}:w=${bw}:h=${bh}`;
}
function encodeArgs(isImage, hasAudio) {
  if (isImage) return ["-frames:v", "1", "-q:v", "2"];
  const args = ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
  if (hasAudio) args.push("-c:a", "copy");
  return args;
}
async function runInpaint(input, output, box) {
  const script = join3(PACKAGE_ROOT, "tools", "inpaint.py");
  if (!existsSync2(script)) throw new Error(`inpaint script missing: ${script}`);
  const py = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const spec = `${box.bw}x${box.bh}+${box.bx}+${box.by}`;
  const r = await run2(py, [script, input, "-o", output, "--box", spec], true);
  if (!r.ok) {
    const hint = /No module named/.test(r.stderr) ? `
install the deps first: ${py} -m pip install torch pillow numpy
(~1.5 GB. Or skip it: --mode delogo is instant and needs only ffmpeg.)` : "";
    throw new Error(`inpaint failed:
${r.stderr.slice(-600)}${hint}`);
  }
}
function isMissingDeps(e) {
  const s = e instanceof Error ? e.message : String(e);
  return /No module named|ENOENT|not recognized|Python was not found|inpaint script missing/i.test(s);
}
var lastLine = (e) => (e instanceof Error ? e.message : String(e)).split("\n").filter((l) => l.trim()).pop() ?? "unknown";
async function inpaintVideo(tools, input, output, box, fps, hasAudio) {
  const work = mkdtempSync2(join3(tmpdir2(), "flow-behind-inpaint-"));
  const [raw, done] = [join3(work, "raw"), join3(work, "done")];
  try {
    mkdirSync3(raw);
    const split = await run2(tools.ffmpeg, [
      "-y",
      "-i",
      input,
      "-vsync",
      "0",
      join3(raw, "f%06d.png")
    ]);
    if (!split.ok) throw new Error(`frame split failed:
${split.stderr.slice(-400)}`);
    const frames = readdirSync2(raw).length;
    if (!frames) throw new Error(`no frames extracted from ${input}`);
    console.error(`inpainting ${frames} frames (~${Math.ceil(frames * 11 / 60)} min)\u2026`);
    await runInpaint(raw, done, box);
    const args = ["-y", "-framerate", fps, "-i", join3(done, "f%06d.png")];
    if (hasAudio) args.push("-i", input, "-map", "0:v", "-map", "1:a", "-c:a", "copy");
    args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p");
    const enc = await run2(tools.ffmpeg, [...args, output]);
    if (!enc.ok) throw new Error(`re-encode failed:
${enc.stderr.slice(-400)}`);
    return `inpainted ${box.bw}x${box.bh} at ${box.bx},${box.by} across ${frames} frames`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
function run2(bin, args, echo = false) {
  return new Promise((res) => {
    const p = spawn3(bin, args);
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr += String(d);
      if (echo) process.stderr.write(String(d));
    });
    p.on("error", (e) => res({ ok: false, stderr: String(e) }));
    p.on("close", (code) => res({ ok: code === 0, stderr }));
  });
}
async function dewatermark(input, output, opts = {}) {
  if (!existsSync2(input)) throw new Error(`input not found: ${input}`);
  const tools = resolveFfmpeg();
  if (!tools) {
    const how = process.platform === "win32" ? "winget install Gyan.FFmpeg" : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg (or your distribution's equivalent)";
    throw new Error(`ffmpeg not found. Install it (${how}) or set FFMPEG_PATH.`);
  }
  const mark = opts.mark ?? "grok";
  const isImage = IMAGE_RE.test(input);
  const mode = opts.mode ?? (mark === "flow" ? isImage ? "inpaint" : "crop" : "crop");
  const { w, h, hasAudio, fps } = probe2(tools.ffprobe, input);
  if (!w || !h) throw new Error(`could not read video dimensions from ${input}`);
  const box = parseBox(opts.box, w, h, mark, isImage);
  if (mode === "inpaint") {
    try {
      if (isImage) {
        await runInpaint(input, output, box);
        return { output, mode, detail: `inpainted ${box.bw}x${box.bh} at ${box.bx},${box.by}` };
      }
      return { output, mode, detail: await inpaintVideo(tools, input, output, box, fps, hasAudio) };
    } catch (e) {
      if (opts.mode || !isMissingDeps(e)) throw e;
      console.error(`inpaint unavailable (${lastLine(e)}); falling back to --mode delogo`);
      return await dewatermark(input, output, { ...opts, mode: "delogo" });
    }
  }
  const args = ["-y", "-i", input];
  let detail;
  if (mode === "cover") {
    if (!opts.logo) throw new Error("--mode cover needs --logo <file.png>");
    if (!existsSync2(opts.logo)) throw new Error(`logo not found: ${opts.logo}`);
    args.push(
      "-i",
      opts.logo,
      "-filter_complex",
      `[1:v]scale=${box.bw}:${box.bh}[lg];[0:v][lg]overlay=${box.bx}:${box.by}`
    );
    detail = `covered ${box.bw}x${box.bh} at ${box.bx},${box.by}`;
  } else if (mode === "delogo") {
    args.push("-vf", delogoFilter(w, h, box));
    detail = `delogo ${box.bw}x${box.bh} at ${box.bx},${box.by}`;
  } else {
    const { vf, detail: d } = cropFilter(w, h, box, opts.cut ?? "auto");
    args.push("-vf", vf);
    detail = d;
  }
  args.push(...encodeArgs(isImage, hasAudio), output);
  const r = await run2(tools.ffmpeg, args);
  if (!r.ok) throw new Error(`ffmpeg failed:
${r.stderr.slice(-600)}`);
  return { output, mode, detail };
}

// src/cli.js
import { Command } from "commander";
import { dirname as dirname42, join as join8, resolve as resolve22 } from "path";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync4, writeFileSync as writeFileSync5 } from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
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
    mkdirSync6(dirname42(file), { recursive: true });
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
  IS_GROK ? "Drive grok.com/imagine batch generation through the Grok Imagine Connector extension" : "Flow Behind CLI \u2014 image, video, character and batch workflows by Flow Behind"
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
    const imagePaths = [...opts.image ?? [], ...opts.video ?? []].map((p) => resolve22(p));
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
      const r = await dewatermark(resolve22(input), resolve22(opts.output), {
        mode,
        mark: opts.mark,
        cut: opts.cut,
        box: opts.box,
        logo: opts.logo ? resolve22(opts.logo) : void 0
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
    const r = await installSkill(name ?? "flow-generate", opts.dir ? resolve22(opts.dir) : defaultSkillsDir());
    if (opts.dir) rememberSkillDir(resolve22(opts.dir));
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
//# sourceMappingURL=cli.js.map
