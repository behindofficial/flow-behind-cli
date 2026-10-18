// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { external_exports } from "./zod.js";
import { ModeSchema, ImageModelSchema, AspectRatioSchema, VideoOptionSchema, VideoResolutionSchema, ImageModeOptionSchema, VideoQualitySchema, ImageQualitySchema } from "./job.js";

var SettingsSchema = external_exports.object({
  defaultMode: ModeSchema.default("text-to-image"),
  // Speed generates in seconds and is far less prone to server-side stalls.
  imageModel: ImageModelSchema.default("speed"),
  aspectRatio: AspectRatioSchema.default("16:9"),
  videoOption: VideoOptionSchema.default("6s"),
  videoResolution: VideoResolutionSchema.default("720p"),
  autoExtendCount: external_exports.number().int().min(0).max(5).default(0),
  /** If a quota (e.g. 720p video) is exhausted, fall back automatically. */
  autoSwitchOnQuota: external_exports.boolean().default(true),
  imageModeOption: ImageModeOptionSchema.default("new-image"),
  maxRetries: external_exports.number().int().min(1).max(20).default(3),
  autoDownloadVideoQuality: VideoQualitySchema.default("720p"),
  autoDownloadImageQuality: ImageQualitySchema.default("1k"),
  language: external_exports.string().default("en"),
  downloadSubfolder: external_exports.string().default("grok-auto"),
  autoRenameFiles: external_exports.boolean().default(true),
  concurrentPrompts: external_exports.number().int().min(1).max(6).default(1),
  delayMinSec: external_exports.number().min(0).max(600).default(15),
  delayMaxSec: external_exports.number().min(0).max(600).default(25),
  outputsPerPrompt: external_exports.number().int().min(1).max(12).default(1),
  maxInputImagesPerPrompt: external_exports.number().int().min(1).max(7).default(4),
  autoAddCharacterImages: external_exports.boolean().default(false),
  bridgeEnabled: external_exports.boolean().default(true),
  bridgePort: external_exports.number().int().default(8791)
});
var DEFAULT_SETTINGS = SettingsSchema.parse({});

export { SettingsSchema, DEFAULT_SETTINGS };
