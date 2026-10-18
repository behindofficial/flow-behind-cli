// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


import { randomUUID } from "crypto";
import { statSync, createReadStream } from "fs";
import { basename as basename2, extname } from "path";
var TTL_MS = 30 * 6e4;
var tokens = /* @__PURE__ */ new Map();
var MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp"
};
function registerFile(path) {
  const ext = extname(path).toLowerCase();
  if (!(ext in MIME)) {
    throw new Error(
      `unsupported input type "${ext || "none"}" \u2014 images (${Object.keys(MIME).filter((e) => MIME[e].startsWith("image/")).join(" ")}) and video (${Object.keys(MIME).filter((e) => MIME[e].startsWith("video/")).join(" ")}) only`
    );
  }
  const stat = statSync(path);
  const meta = {
    token: randomUUID(),
    name: basename2(path),
    mime: MIME[ext] ?? "application/octet-stream",
    size: stat.size
  };
  tokens.set(meta.token, { path, meta, expiresAt: Date.now() + TTL_MS });
  return meta;
}
function serveFile(token, res) {
  const rec = tokens.get(token);
  if (!rec || rec.expiresAt < Date.now()) {
    res.writeHead(404).end("unknown or expired token");
    return;
  }
  res.writeHead(200, {
    "content-type": rec.meta.mime,
    "content-length": rec.meta.size
  });
  createReadStream(rec.path).pipe(res);
}
function sweepExpiredTokens() {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
}

export { randomUUID, statSync, createReadStream, basename2, extname, TTL_MS, tokens, MIME, registerFile, serveFile, sweepExpiredTokens };
