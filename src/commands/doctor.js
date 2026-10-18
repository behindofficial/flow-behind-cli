// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { isUnlimitedDaily } from "../shared/protocol.js";
import { resolveFfmpeg } from "./merge.js";
import { defaultSkillsDir } from "./skill.js";

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

export { existsSync5, join6, MIN_NODE_MAJOR, checkNode, checkBridge, checkExtension, checkLoggedIn, checkTabVisible, checkSingleInstall, checkAccess, checkLayout, checkPlan, checkQueue, checkCooldown, checkFfmpeg, checkSkill, runChecks, anyFailed, ffmpegPresent, skillPresent, MARK, format };
