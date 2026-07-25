import fs from "node:fs";
import path from "node:path";

// Server-only env loader. Next.js only auto-loads env files from the web/
// directory, but this project keeps one shared secrets file at the repo root
// (used by eval.py too). Load it here without overriding real env vars.
const rootEnv = path.resolve(process.cwd(), "..", ".env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (check the repo-root .env)`);
  return v;
}
