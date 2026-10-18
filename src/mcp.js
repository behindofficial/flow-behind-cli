import { BRAND, updatesDisabled } from "./brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { BRIDGE_DEFAULT_PORT, SiteSchema } from "./shared/protocol.js";
import { startBridgeServer } from "./bridge/server.js";
import { BridgeClient } from "./bridge-client/index.js";
import { AGENT_CONFIG_URL, agentConfigOf, noticeLine } from "./shared/agent-notices.js";
import { ModeSchema, AspectRatioSchema, ImageModelSchema, siteForMode, MODE_LIMITS, tooManyReferences, JobParamsSchema } from "./shared/job.js";
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z as z5 } from "zod";
import { fileURLToPath } from "url";
import { resolve } from "path";

// src/index.ts
var CALL_BUDGET_MS = 4e4;
if (process.argv[2] === "--start-bridge") {
  const port = Number(process.argv[3] ?? BRIDGE_DEFAULT_PORT);
  startBridgeServer(port).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
async function main() {
  const selfEntry = fileURLToPath(import.meta.url);
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
        args.image_paths.map((p) => resolve(p))
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
