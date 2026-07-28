// Copies every <org>/evals/cases.json from the repo root into web/evals/ so the
// files exist inside the deployment.
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

const orgs = fs
  .readdirSync(repoRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .filter((d) => fs.existsSync(path.join(repoRoot, d.name, "evals", "cases.json")))
  .map((d) => d.name);

fs.rmSync(outDir, { recursive: true, force: true });

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
