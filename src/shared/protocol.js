// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { external_exports } from "./zod.js";
import { JobStageSchema, JobResultFileSchema, JobSpecSchema, JobSchema } from "./job.js";

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

export { BRIDGE_DEFAULT_PORT, BRIDGE_HOST, SiteSchema, BrowserSchema, BridgeFileMetaSchema, ExtToBridgeSchema, BridgeToExtSchema, SubmitJobRequestSchema, SubmitJobResponseSchema, BridgeStatusSchema, BridgeJobSchema, UNLIMITED_DAILY, isUnlimitedDaily };
