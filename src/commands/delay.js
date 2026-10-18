// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


function parseDelay(spec, flag = "--delay") {
  if (!spec) return void 0;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*$/.exec(spec);
  if (!m) throw new Error(`bad ${flag} "${spec}" \u2014 use seconds like 12 or a range like 10-15`);
  const min = Number(m[1]);
  const max = m[2] !== void 0 ? Number(m[2]) : min;
  return { minSec: Math.min(min, max), maxSec: Math.max(min, max) };
}

export { parseDelay };
