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

// src/bridge-client/index.js
import { spawn } from "node:child_process";
import { basename } from "node:path";
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
    const client = (process.env.FLOW_BEHIND_CLIENT || process.env.GROK_AUTO_CLIENT || basename(process.cwd())).slice(0, 64);
    return this.post("/jobs", { job, imagePaths, client });
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

// src/mcp.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z as z5 } from "zod";
import { fileURLToPath as fileURLToPath2 } from "url";
import { resolve as resolve2 } from "path";
var CALL_BUDGET_MS = 4e4;
if (process.argv[2] === "--start-bridge") {
  const port = Number(process.argv[3] ?? BRIDGE_DEFAULT_PORT);
  startBridgeServer(port).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
async function main() {
  const selfEntry = fileURLToPath2(import.meta.url);
  const client = new BridgeClient({
    spawnArgs: [selfEntry, "--start-bridge"]
  });
  const connector = BRAND.command;
  const homeSite = (process.env.CONNECTOR_BIN ?? "").startsWith("grok-auto") ? "grok" : "flow";
  const server = new McpServer({ name: connector, version: BRAND.version });
  const text = (s) => ({ content: [{ type: "text", text: s }] });
  const report = (job, note = "") => {
    if (job.status === "done") {
      const warning = job.error ? `
Warning: ${job.error}` : "";
      return text(`Generation complete. Files:
${job.files.map((f) => f.path).join("\n")}${warning}${note}`);
    }
    if (job.status === "failed" || job.status === "cancelled") {
      return text(`Generation ${job.status}: ${job.error ?? "no details"}${job.stage ? ` (stage: ${job.stage})` : ""}`);
    }
    return text(
      `Still generating \u2014 this is normal, a video can take several minutes. Job id: ${job.id}
Call ${homeSite}_get_job with this job_id to keep waiting, and repeat until it is done. Do NOT call ${homeSite}_generate again for this prompt \u2014 that starts a second generation.${note}`
    );
  };
  const isFlow = homeSite === "flow";
  const own = (all, keep) => z5.enum(isFlow ? all.filter(keep) : all);
  const served = { at: 0, cfg: {} };
  const noticeText = async () => {
    if (!isFlow || updatesDisabled()) return "";
    if (Date.now() - served.at > 5 * 6e4) {
      served.at = Date.now();
      try {
        const res = await fetch(AGENT_CONFIG_URL, { signal: AbortSignal.timeout(2e3) });
        if (res.ok) served.cfg = agentConfigOf(await res.json());
      } catch {
      }
    }
    return (served.cfg.notices ?? []).map((n) => `
${noticeLine(n)}`).join("");
  };
  server.tool(
    `${homeSite}_generate`,
    (isFlow ? "Generate images or videos on Google Flow (flow.google.com) through the user's own browser session (free, no API). flow-text-to-image, flow-image-to-image \u2014 Nano Banana Pro/2/Lite; flow-text-to-video, flow-frame-to-video, flow-ingredients-to-video \u2014 Omni Flash / Veo 3.1 Lite|Fast|Quality, 4/6/8/10s, 16:9 or 9:16 only; flow-extend-video \u2014 lengthen the Veo clip the user currently has open in Flow's scene editor, prompt = what happens next. " : "Generate images or videos through the user's own browser session (free, no API). Covers TWO sites via the mode value: grok.com/imagine (text-to-image, image-to-image, text-to-video, frame-to-video, ingredients-to-video) and flow.google.com (flow-text-to-image, flow-image-to-image \u2014 Nano Banana Pro/2/Lite; flow-text-to-video, flow-frame-to-video, flow-ingredients-to-video \u2014 Omni Flash / Veo 3.1 Lite|Fast|Quality, 4/6/8/10s, 16:9 or 9:16 only; flow-extend-video \u2014 lengthen the Veo clip the user currently has open in Flow's scene editor, prompt = what happens next). ") + `Returns the local file paths of the downloaded media if it finishes within ~40 s; otherwise returns a job id \u2014 keep calling ${homeSite}_get_job with it until the job is done. Flow generation is deliberately slow and low-concurrency (anti-bot pacing) \u2014 a long wait or a 'cooldown active' status is expected behavior, not a bug.`,
    {
      mode: own(ModeSchema.options, (m) => m.startsWith("flow-")).describe(
        isFlow ? "generation mode" : "generation mode \u2014 flow-* modes run on flow.google.com, others on grok.com"
      ),
      prompt: z5.string().min(1).describe("the generation prompt"),
      image_paths: z5.array(z5.string()).default([]).describe("absolute local paths of input images (image-to-image / frame / ingredients)"),
      aspect_ratio: AspectRatioSchema.default("16:9"),
      duration: own(["4", "6", "8", "10", "15"], (d) => d !== "15").optional().describe(isFlow ? "video duration in seconds" : "video duration in seconds \u2014 grok: 6|10|15, flow: 4|6|8|10"),
      image_model: own(ImageModelSchema.options, (m) => m !== "quality" && m !== "speed").optional().describe(
        (isFlow ? "" : "grok: quality|speed \u2014 flow ") + "image: nano-banana-pro|nano-banana-2|nano-banana-2-lite \u2014 video: omni-flash|veo-3.1-lite|veo-3.1-fast|veo-3.1-quality (quality is the expensive one)"
      ),
      outputs: z5.number().int().min(1).max(12).default(1),
      folder: z5.string().default(connector).describe("download subfolder under Chrome Downloads")
    },
    async (args) => {
      const deadline = Date.now() + CALL_BUDGET_MS;
      const mode = args.mode;
      const site = siteForMode(mode);
      const limits = MODE_LIMITS[mode];
      const tooMany = tooManyReferences(mode, args.image_model, args.image_paths.length);
      if (tooMany) return text(`${tooMany}.`);
      if (args.outputs > limits.maxOutputs) {
        return text(`${mode} allows at most ${limits.maxOutputs} outputs per prompt.`);
      }
      let status = await client.ensureBridge(site);
      while (!status.extensionConnected && Date.now() < deadline - 5e3) {
        await new Promise((r) => setTimeout(r, 1e3));
        status = await client.status(site) ?? status;
      }
      if (!status.extensionConnected) {
        const label = site === "flow" ? "Flow Connector" : "Grok Imagine Connector";
        const hint = site === "flow" ? "flow.google.com" : "grok.com/imagine";
        return text(
          `The ${label} extension is not connected. Ask the user to open a browser with the extension installed and a ${hint} tab that stays VISIBLE (hidden tabs are throttled), then retry.`
        );
      }
      const params = JobParamsSchema.parse({
        aspectRatio: args.aspect_ratio,
        videoOption: args.duration ? `${args.duration}s` : void 0,
        imageModel: args.image_model,
        outputsPerPrompt: args.outputs,
        downloadSubfolder: args.folder,
        autoRenameFiles: true
      });
      const spec = {
        prompt: args.prompt,
        mode,
        params,
        inputImages: []
      };
      const { jobId, warning: shared } = await client.submitJob(
        spec,
        args.image_paths.map((p) => resolve2(p))
      );
      const job = await client.waitJob(jobId, Math.max(1e3, deadline - Date.now()));
      return report(job, (shared ? `
Warning: ${shared}` : "") + await noticeText());
    }
  );
  server.tool(
    `${homeSite}_status`,
    "Check the bridge: is the daemon up, is the extension connected, plan usage, active jobs, and whether an anti-bot cooldown is active.",
    { site: own(SiteSchema.options, (x) => x === "flow").default(homeSite).describe("which extension's status to check") },
    async (args) => {
      const status = await client.status(args.site);
      if (!status) return text(`Bridge daemon is down (it auto-starts when ${homeSite}_generate is called).`);
      return text(JSON.stringify(status, null, 2) + await noticeText());
    }
  );
  server.tool(
    `${homeSite}_list_jobs`,
    "List recent generation jobs with status and files.",
    {},
    async () => {
      const jobs2 = await client.listJobs();
      const lines = jobs2.slice(0, 20).map((j) => `${j.id} ${j.status} ${j.mode} "${j.prompt.slice(0, 60)}" ${j.files.map((f) => f.path).join(",")}`);
      return text(lines.join("\n") || "no jobs yet");
    }
  );
  server.tool(
    `${homeSite}_get_job`,
    "Wait for a generation job (up to ~40 s per call) and return its status and files. Call it again while the job is still generating.",
    { job_id: z5.string() },
    async (args) => report(await client.waitJob(args.job_id, CALL_BUDGET_MS))
  );
  await server.connect(new StdioServerTransport());
}
//# sourceMappingURL=mcp.js.map
