// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { external_exports } from "./zod.js";

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

export { AGENT_CONFIG_URL, AgentNoticeSchema, AgentConfigSchema, agentConfigOf, LABEL, noticeLine };
