// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


var RUN_GAP_MS = 15 * 6e4;
function failedThisRun(jobs2, all = false) {
  const scope = [];
  if (all) {
    scope.push(...jobs2);
  } else {
    const folder = jobs2.find((j) => j.params?.downloadSubfolder)?.params?.downloadSubfolder;
    if (folder) {
      scope.push(...jobs2.filter((j) => j.params?.downloadSubfolder === folder));
    } else {
      let prev = jobs2[0]?.createdAt ?? 0;
      for (const j of jobs2) {
        if (prev - (j.createdAt ?? 0) > RUN_GAP_MS) break;
        prev = j.createdAt ?? prev;
        scope.push(j);
      }
    }
  }
  const slot = (j) => j.batchIndex !== void 0 ? `${j.params?.downloadSubfolder ?? ""}#${j.batchIndex}` : `p:${j.prompt}`;
  const done = new Set(scope.filter((j) => j.status === "done").map(slot));
  const seen = /* @__PURE__ */ new Set();
  return scope.filter((j) => {
    if (j.status !== "failed") return false;
    const key = slot(j);
    if (done.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { RUN_GAP_MS, failedThisRun };
