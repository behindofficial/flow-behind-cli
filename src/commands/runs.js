import { STATE_DIR } from "../brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync2, readdirSync as readdirSync3, statSync as statSync2, writeFileSync as writeFileSync3 } from "fs";
import { homedir as homedir3 } from "os";
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
    const raw = readFileSync2(manifestPath(run3), "utf8");
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

export { existsSync4, mkdirSync4, readFileSync2, readdirSync3, statSync2, writeFileSync3, homedir3, join5, DIR2, safeRunName, manifestPath, readRun, appendToRun, listRuns, TERMINAL2, runReport, toResume };
