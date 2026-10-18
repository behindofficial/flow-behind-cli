// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { external_exports } from "./zod.js";

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

export { ModeSchema, siteForMode, MODE_LIMITS, VEO_INGREDIENTS_MAX, INGREDIENTS_MAX, maxReferences, tooManyReferences, MANY_INGREDIENTS_EXT, versionAtLeast, AspectRatioSchema, VideoOptionSchema, ImageModelSchema, VideoResolutionSchema, ImageModeOptionSchema, VideoQualitySchema, ImageQualitySchema, InputImageRefSchema, JobParamsSchema, JobStatusSchema, JobStageSchema, JobResultFileSchema, JobSpecSchema, JobSchema };
