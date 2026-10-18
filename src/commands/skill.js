import { PACKAGE_ROOT, BRAND } from "../brand.js";
// Adapted from flow-connector-cli 1.0.9; see THIRD_PARTY_NOTICES.md.


import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync as existsSync3 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname2, join as join4 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var SKILLS = {
  "flow-generate": {
    pkgDir: "skill-flow",
    pkg: BRAND.package,
    description: "Flow Behind: Google Flow (Nano Banana / Veo) image + video generation"
  },
  "grok-generate": {
    pkgDir: "skill",
    pkg: "grok-imagine-connector",
    description: "grok.com/imagine image + video generation"
  }
};
var here = dirname2(fileURLToPath2(import.meta.url));
function sourceCandidates(name, pkgDir) {
  return [
    join4(PACKAGE_ROOT, "skills", name, "SKILL.md"),
    join4(here, "..", "..", pkgDir, "SKILL.md")
  ];
}
function isBundled(name) {
  const spec = SKILLS[name];
  return !!spec && sourceCandidates(name, spec.pkgDir).some((p) => existsSync3(p));
}
function defaultSkillsDir() {
  return join4(homedir2(), ".claude", "skills");
}
async function installSkill(name, skillsDir) {
  const spec = SKILLS[name];
  if (!spec) {
    throw new Error(`unknown skill "${name}" \u2014 known: ${Object.keys(SKILLS).join(", ")}`);
  }
  const source = sourceCandidates(name, spec.pkgDir).find((p) => existsSync3(p));
  if (!source) {
    throw new Error(
      `could not find the bundled SKILL.md for "${name}" \u2014 it ships with a different package: npm install -g ${spec.pkg}`
    );
  }
  const content = await readFile(source, "utf8");
  const target = join4(skillsDir, name, "SKILL.md");
  if (existsSync3(target)) {
    const existing = await readFile(target, "utf8");
    if (existing === content) return { name, target, status: "already-current" };
    await writeFile(target, content, "utf8");
    return { name, target, status: "updated" };
  }
  await mkdir(dirname2(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { name, target, status: "installed" };
}

export { mkdir, readFile, writeFile, existsSync3, homedir2, dirname2, join4, fileURLToPath2, SKILLS, here, sourceCandidates, isBundled, defaultSkillsDir, installSkill };
