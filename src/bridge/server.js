import { BRAND } from "../brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { siteForMode, MODE_LIMITS, tooManyReferences, VEO_INGREDIENTS_MAX, versionAtLeast, MANY_INGREDIENTS_EXT } from "../shared/job.js";
import { updateJob, pendingJobs, orphanedJobs, getJob, expireStale, addJob, listJobs, clearFinished, waitForJob, loadJobs } from "./job-store.js";
import { ExtToBridgeSchema, BRIDGE_HOST, SubmitJobRequestSchema } from "../shared/protocol.js";
import { registerFile, serveFile, sweepExpiredTokens } from "./file-service.js";

import { createServer } from "http";
import { randomUUID as randomUUID2 } from "crypto";
import { createRequire } from "module";
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

export { createServer, randomUUID2, createRequire, WebSocketServer, WebSocket, BRIDGE_VERSION, TAKEOVER_WINDOW_MS, TAKEOVER_FIGHT, freshExtState, extensions, getExt, wsSite, jobFiles, sendToExt, dispatchJob, flushPending, handleExtMessage, logsWaiters, domWaiters, fetchExtDom, fetchExtLogs, healthcheckWaiters, fetchHealthcheck, readBody, json, originAllowed, hostIsLoopback, handleHttp, startBridgeServer };
