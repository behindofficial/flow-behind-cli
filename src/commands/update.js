import { BRAND } from "../brand.js";
import { STATE_DIR } from "../brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { versionAtLeast } from "../shared/job.js";
import { defaultSkillsDir, SKILLS, isBundled, installSkill } from "./skill.js";
import { AGENT_CONFIG_URL, agentConfigOf, noticeLine } from "../shared/agent-notices.js";

import { execFileSync } from "child_process";
import { existsSync as existsSync6, mkdirSync as mkdirSync5, readFileSync as readFileSync3, writeFileSync as writeFileSync4 } from "fs";
import { homedir as homedir4 } from "os";
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

export { execFileSync, existsSync6, mkdirSync5, readFileSync3, writeFileSync4, homedir4, dirname3, join7, FILE2, CHECK_EVERY_MS, CONFIG_EVERY_MS, REPEAT_NOTICE_MS, CONFIG_PACKAGE, read, write, updateLine, rememberSkillDir, syncSkills, checkNpm, checkConfig, newest, dueNotices, pidFromNetstat, pidOnPort, replaceStaleBridge, keepCurrent };
