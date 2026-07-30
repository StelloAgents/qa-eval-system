// Copies every <org>/evals/cases.json into web/evals/ and every <org>/kb/*.md
// into web/kb/<org>/ so both exist inside the deployment.
//
// Vercel's Root Directory is `web`, so anything above it is present at build
// time but absent at runtime — the runner would throw "no test cases found" on
// every request. Runs as `prebuild`, so `next build` can never miss it.
//
// The copies are gitignored: cases.json at the repo root stays the single
// source of truth, and eval.py keeps reading it from there.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const outDir = path.resolve(process.cwd(), "evals");
const kbOutDir = path.resolve(process.cwd(), "kb");

const orgs = fs
  .readdirSync(repoRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .filter((d) => fs.existsSync(path.join(repoRoot, d.name, "evals", "cases.json")))
  .map((d) => d.name);

fs.rmSync(outDir, { recursive: true, force: true });
fs.rmSync(kbOutDir, { recursive: true, force: true });

let total = 0;
for (const org of orgs) {
  const src = path.join(repoRoot, org, "evals", "cases.json");
  const dest = path.join(outDir, org, "cases.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Parse before copying: a malformed cases.json should fail the build here
  // rather than at runtime on a request.
  const cases = JSON.parse(fs.readFileSync(src, "utf8"));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`${org}/evals/cases.json is empty or not an array`);
  }
  fs.writeFileSync(dest, JSON.stringify(cases));
  console.log(`  collected ${org}: ${cases.length} cases`);
  total += cases.length;
}

if (orgs.length === 0) {
  throw new Error("no <org>/evals/cases.json found at the repo root");
}
console.log(`collect-cases: ${orgs.length} orgs, ${total} cases → web/evals/`);

// Knowledge base documents, used by /api/evals/draft to ground answers. Absent
// for an org that has no kb/ directory, which is fine — that org simply cannot
// draft, and the route returns a 404 saying so rather than failing the build.
let kbFiles = 0;
for (const org of fs.readdirSync(repoRoot, { withFileTypes: true })) {
  if (!org.isDirectory() || org.name.startsWith(".")) continue;
  const srcDir = path.join(repoRoot, org.name, "kb");
  if (!fs.existsSync(srcDir)) continue;
  const docs = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
  if (!docs.length) continue;
  const destDir = path.join(kbOutDir, org.name);
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of docs) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    // Preserve mtime: the draft route picks the newest .md, and a plain copy
    // would stamp every file with the build time and make that choice random.
    const { atime, mtime } = fs.statSync(path.join(srcDir, f));
    fs.utimesSync(path.join(destDir, f), atime, mtime);
    kbFiles++;
  }
  console.log(`  collected ${org.name}: ${docs.length} KB document(s)`);
}
console.log(`collect-cases: ${kbFiles} KB document(s) → web/kb/`);
