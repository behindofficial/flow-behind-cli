import { PACKAGE_ROOT } from "../brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.
import { resolveFfmpeg } from "./merge.js";

import { spawn as spawn3, spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync3, mkdtempSync as mkdtempSync2, readdirSync as readdirSync2, rmSync } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join3 } from "path";
import { fileURLToPath } from "url";
var BOX_W_FRAC = 0.17;
var BOX_H_RATIO = 0.42;
var FLOW_BOX = {
  image: { off: 126, size: 58 },
  // sparkle ~45px, 75px inset
  video: { off: 151, size: 64 }
  // sparkle ~47px, 96px inset
};
var IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
var even = (n) => Math.max(2, Math.floor(n / 2) * 2);
function probe2(ffprobe, input) {
  const r = spawnSync2(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,r_frame_rate",
      "-of",
      "json",
      input
    ],
    { encoding: "utf8" }
  );
  let w = 0, h = 0, hasAudio = false, fps = "30";
  try {
    const j = JSON.parse(r.stdout);
    for (const s of j.streams ?? []) {
      if (s.codec_type === "video") {
        w = Number(s.width) || w;
        h = Number(s.height) || h;
        if (typeof s.r_frame_rate === "string" && s.r_frame_rate !== "0/0") fps = s.r_frame_rate;
      }
      if (s.codec_type === "audio") hasAudio = true;
    }
  } catch {
  }
  return { w, h, hasAudio, fps };
}
function parseBox(spec, w, h, mark, isImage) {
  if (spec) {
    const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(spec);
    if (!m) throw new Error(`bad --box "${spec}" (want WxH+X+Y, e.g. 200x80+1080+640)`);
    const [bw2, bh2, bx, by] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (bx + bw2 > w || by + bh2 > h) {
      throw new Error(`box ${bw2}x${bh2}+${bx}+${by} exceeds the ${w}x${h} frame`);
    }
    return { bx, by, bw: bw2, bh: bh2 };
  }
  if (mark === "flow") {
    const { off, size } = isImage ? FLOW_BOX.image : FLOW_BOX.video;
    if (off > w || off > h) {
      throw new Error(`${w}x${h} is too small for the flow mark preset; pass --box`);
    }
    return { bx: w - off, by: h - off, bw: size, bh: size };
  }
  const bw = Math.round(w * BOX_W_FRAC);
  const bh = Math.min(Math.round(bw * BOX_H_RATIO), h);
  return { bx: w - bw, by: h - bh, bw, bh };
}
function cropFilter(w, h, box, cut) {
  const rightW = box.bx;
  const rightH = Math.floor(rightW * h / w);
  const bottomH = box.by;
  const bottomW = Math.floor(bottomH * w / h);
  const chosen = cut === "auto" ? bottomH * bottomW >= rightW * rightH ? "bottom" : "right" : cut;
  let cw, ch, x, y;
  switch (chosen) {
    case "bottom":
      cw = even(bottomW);
      ch = even(bottomH);
      [x, y] = [`(${w}-${cw})/2`, "0"];
      break;
    case "center":
      ch = even(h - 2 * box.bh);
      cw = even(ch * w / h);
      [x, y] = [`(${w}-${cw})/2`, `(${h}-${ch})/2`];
      break;
    case "topleft":
      cw = even(bottomW);
      ch = even(bottomH);
      [x, y] = ["0", "0"];
      break;
    default:
      cw = even(rightW);
      ch = even(rightH);
      [x, y] = ["0", `(${h}-${ch})/2`];
  }
  return {
    vf: `crop=${cw}:${ch}:${x}:${y},scale=${w}:${h},setsar=1`,
    detail: `${chosen}-cut ${cw}x${ch} -> ${w}x${h}`
  };
}
function delogoFilter(w, h, box) {
  const x = Math.max(2, box.bx);
  const y = Math.max(2, box.by);
  const bw = Math.min(box.bw, w - x - 2);
  const bh = Math.min(box.bh, h - y - 2);
  return `delogo=x=${x}:y=${y}:w=${bw}:h=${bh}`;
}
function encodeArgs(isImage, hasAudio) {
  if (isImage) return ["-frames:v", "1", "-q:v", "2"];
  const args = ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
  if (hasAudio) args.push("-c:a", "copy");
  return args;
}
async function runInpaint(input, output, box) {
  const script = join3(PACKAGE_ROOT, "tools", "inpaint.py");
  if (!existsSync2(script)) throw new Error(`inpaint script missing: ${script}`);
  const py = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const spec = `${box.bw}x${box.bh}+${box.bx}+${box.by}`;
  const r = await run2(py, [script, input, "-o", output, "--box", spec], true);
  if (!r.ok) {
    const hint = /No module named/.test(r.stderr) ? `
install the deps first: ${py} -m pip install torch pillow numpy
(~1.5 GB. Or skip it: --mode delogo is instant and needs only ffmpeg.)` : "";
    throw new Error(`inpaint failed:
${r.stderr.slice(-600)}${hint}`);
  }
}
function isMissingDeps(e) {
  const s = e instanceof Error ? e.message : String(e);
  return /No module named|ENOENT|not recognized|Python was not found|inpaint script missing/i.test(s);
}
var lastLine = (e) => (e instanceof Error ? e.message : String(e)).split("\n").filter((l) => l.trim()).pop() ?? "unknown";
async function inpaintVideo(tools, input, output, box, fps, hasAudio) {
  const work = mkdtempSync2(join3(tmpdir2(), "flow-behind-inpaint-"));
  const [raw, done] = [join3(work, "raw"), join3(work, "done")];
  try {
    mkdirSync3(raw);
    const split = await run2(tools.ffmpeg, [
      "-y",
      "-i",
      input,
      "-vsync",
      "0",
      join3(raw, "f%06d.png")
    ]);
    if (!split.ok) throw new Error(`frame split failed:
${split.stderr.slice(-400)}`);
    const frames = readdirSync2(raw).length;
    if (!frames) throw new Error(`no frames extracted from ${input}`);
    console.error(`inpainting ${frames} frames (~${Math.ceil(frames * 11 / 60)} min)\u2026`);
    await runInpaint(raw, done, box);
    const args = ["-y", "-framerate", fps, "-i", join3(done, "f%06d.png")];
    if (hasAudio) args.push("-i", input, "-map", "0:v", "-map", "1:a", "-c:a", "copy");
    args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p");
    const enc = await run2(tools.ffmpeg, [...args, output]);
    if (!enc.ok) throw new Error(`re-encode failed:
${enc.stderr.slice(-400)}`);
    return `inpainted ${box.bw}x${box.bh} at ${box.bx},${box.by} across ${frames} frames`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
function run2(bin, args, echo = false) {
  return new Promise((res) => {
    const p = spawn3(bin, args);
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr += String(d);
      if (echo) process.stderr.write(String(d));
    });
    p.on("error", (e) => res({ ok: false, stderr: String(e) }));
    p.on("close", (code) => res({ ok: code === 0, stderr }));
  });
}
async function dewatermark(input, output, opts = {}) {
  if (!existsSync2(input)) throw new Error(`input not found: ${input}`);
  const tools = resolveFfmpeg();
  if (!tools) {
    const how = process.platform === "win32" ? "winget install Gyan.FFmpeg" : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg (or your distribution's equivalent)";
    throw new Error(`ffmpeg not found. Install it (${how}) or set FFMPEG_PATH.`);
  }
  const mark = opts.mark ?? "grok";
  const isImage = IMAGE_RE.test(input);
  const mode = opts.mode ?? (mark === "flow" ? isImage ? "inpaint" : "crop" : "crop");
  const { w, h, hasAudio, fps } = probe2(tools.ffprobe, input);
  if (!w || !h) throw new Error(`could not read video dimensions from ${input}`);
  const box = parseBox(opts.box, w, h, mark, isImage);
  if (mode === "inpaint") {
    try {
      if (isImage) {
        await runInpaint(input, output, box);
        return { output, mode, detail: `inpainted ${box.bw}x${box.bh} at ${box.bx},${box.by}` };
      }
      return { output, mode, detail: await inpaintVideo(tools, input, output, box, fps, hasAudio) };
    } catch (e) {
      if (opts.mode || !isMissingDeps(e)) throw e;
      console.error(`inpaint unavailable (${lastLine(e)}); falling back to --mode delogo`);
      return await dewatermark(input, output, { ...opts, mode: "delogo" });
    }
  }
  const args = ["-y", "-i", input];
  let detail;
  if (mode === "cover") {
    if (!opts.logo) throw new Error("--mode cover needs --logo <file.png>");
    if (!existsSync2(opts.logo)) throw new Error(`logo not found: ${opts.logo}`);
    args.push(
      "-i",
      opts.logo,
      "-filter_complex",
      `[1:v]scale=${box.bw}:${box.bh}[lg];[0:v][lg]overlay=${box.bx}:${box.by}`
    );
    detail = `covered ${box.bw}x${box.bh} at ${box.bx},${box.by}`;
  } else if (mode === "delogo") {
    args.push("-vf", delogoFilter(w, h, box));
    detail = `delogo ${box.bw}x${box.bh} at ${box.bx},${box.by}`;
  } else {
    const { vf, detail: d } = cropFilter(w, h, box, opts.cut ?? "auto");
    args.push("-vf", vf);
    detail = d;
  }
  args.push(...encodeArgs(isImage, hasAudio), output);
  const r = await run2(tools.ffmpeg, args);
  if (!r.ok) throw new Error(`ffmpeg failed:
${r.stderr.slice(-600)}`);
  return { output, mode, detail };
}

export { spawn3, spawnSync2, existsSync2, mkdirSync3, mkdtempSync2, readdirSync2, rmSync, tmpdir2, join3, fileURLToPath, BOX_W_FRAC, BOX_H_RATIO, FLOW_BOX, IMAGE_RE, even, probe2, parseBox, cropFilter, delogoFilter, encodeArgs, runInpaint, isMissingDeps, lastLine, inpaintVideo, run2, dewatermark };
