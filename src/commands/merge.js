// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


import { spawn as spawn2, spawnSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, readdirSync } from "fs";
import { tmpdir } from "os";
import { dirname, join as join2, resolve } from "path";
function resolveFfmpeg() {
  const onPath = (bin) => {
    try {
      const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
      return r.status === 0 || r.status === 1;
    } catch {
      return false;
    }
  };
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    const dir = process.env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, "");
    const probe3 = join2(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    return { ffmpeg: process.env.FFMPEG_PATH, ffprobe: existsSync(probe3) ? probe3 : "ffprobe" };
  }
  if (onPath("ffmpeg")) return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
  const local = process.env.LOCALAPPDATA;
  if (local && process.platform === "win32") {
    const pkgRoot = join2(local, "Microsoft", "WinGet", "Packages");
    try {
      const gyan = readdirSync(pkgRoot).find((d) => /^Gyan\.FFmpeg/i.test(d));
      if (gyan) {
        const buildDir = readdirSync(join2(pkgRoot, gyan)).find((d) => /^ffmpeg-.*build$/i.test(d));
        if (buildDir) {
          const bin = join2(pkgRoot, gyan, buildDir, "bin");
          const ff = join2(bin, "ffmpeg.exe");
          const fp = join2(bin, "ffprobe.exe");
          if (existsSync(ff)) return { ffmpeg: ff, ffprobe: existsSync(fp) ? fp : "ffprobe" };
        }
      }
    } catch {
    }
  }
  return null;
}
function probe(ffprobe, input) {
  const r = spawnSync(
    ffprobe,
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", input],
    { encoding: "utf8" }
  );
  let width = 0, height = 0, hasAudio = false;
  try {
    const j = JSON.parse(r.stdout);
    for (const s of j.streams ?? []) {
      if (s.codec_type === "video") {
        width = Number(s.width) || width;
        height = Number(s.height) || height;
      }
      if (s.codec_type === "audio") hasAudio = true;
    }
  } catch {
  }
  return { width, height, hasAudio };
}
function run(bin, args) {
  return new Promise((res) => {
    const p = spawn2(bin, args);
    let stderr = "";
    p.stderr.on("data", (d) => stderr += String(d));
    p.on("error", (e) => res({ ok: false, stderr: String(e) }));
    p.on("close", (code) => res({ ok: code === 0, stderr }));
  });
}
async function mergeVideos(inputsRaw, outputRaw, tools, opts = {}) {
  const inputs = inputsRaw.map((p) => resolve(p));
  const output = resolve(outputRaw);
  for (const i of inputs) if (!existsSync(i)) throw new Error(`input not found: ${i}`);
  if (inputs.length < 2) throw new Error("need at least 2 videos to merge");
  mkdirSync2(dirname(output), { recursive: true });
  if (opts.fast) {
    const tmp = mkdtempSync(join2(tmpdir(), "flow-behind-merge-"));
    const listFile = join2(tmp, "list.txt");
    writeFileSync2(
      listFile,
      inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8"
    );
    const copy = await run(tools.ffmpeg, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      output
    ]);
    if (copy.ok && existsSync(output)) return { output, method: "copy", inputs: inputs.length };
  }
  const probes = inputs.map((i) => probe(tools.ffprobe, i));
  const W = Math.max(...probes.map((p) => p.width || 0)) || 1280;
  const H = Math.max(...probes.map((p) => p.height || 0)) || 720;
  const allAudio = probes.every((p) => p.hasAudio);
  const args = ["-y"];
  for (const i of inputs) args.push("-i", i);
  const parts = [];
  const streams = [];
  inputs.forEach((_, idx) => {
    parts.push(
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${idx}]`
    );
    streams.push(`[v${idx}]`);
    if (allAudio) streams.push(`[${idx}:a]`);
  });
  const concat = `${streams.join("")}concat=n=${inputs.length}:v=1:a=${allAudio ? 1 : 0}[outv]${allAudio ? "[outa]" : ""}`;
  args.push("-filter_complex", `${parts.join(";")};${concat}`);
  args.push("-map", "[outv]");
  if (allAudio) args.push("-map", "[outa]");
  args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  if (allAudio) args.push("-c:a", "aac", "-b:a", "192k");
  args.push(output);
  const re = await run(tools.ffmpeg, args);
  if (!re.ok || !existsSync(output)) {
    throw new Error(`ffmpeg merge failed:
${re.stderr.split("\n").slice(-8).join("\n")}`);
  }
  return { output, method: "reencode", inputs: inputs.length };
}

export { spawn2, spawnSync, existsSync, mkdtempSync, mkdirSync2, writeFileSync2, readdirSync, tmpdir, dirname, join2, resolve, resolveFfmpeg, probe, run, mergeVideos };
