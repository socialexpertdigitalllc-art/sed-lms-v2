// Bundles the standalone Ticket Agent worker (scripts/agent-worker.ts) into a
// self-contained kit at dist/agent-worker/: one .mjs with every dependency
// inlined, an env template and the per-OS installers. A device needs only
// Node >= 20 + a signed-in `agy` — no repo, no npm install, no Next build.
//
//   npm run build:agent-worker                 kit without secrets
//   npm run build:agent-worker -- --with-env   also writes agent-worker.env
//                                              from .env.local (PRIVATE kit)
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "dist/agent-worker";
const KIT = "scripts/agent-worker-kit";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ["scripts/agent-worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(OUT, "agent-worker.mjs"),
  tsconfig: "tsconfig.json",
  // Bundled CommonJS dependencies call require() for node builtins; ESM has
  // no require, so provide one.
  banner: { js: "import { createRequire as __sedCreateRequire } from 'node:module'; const require = __sedCreateRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});

for (const f of ["install-windows.ps1", "uninstall-windows.ps1", "run-worker.cmd", "start-worker.sh", "README.txt", "agent-worker.env.example"]) {
  copyFileSync(join(KIT, f), join(OUT, f));
}
copyFileSync("scripts/run-hidden.vbs", join(OUT, "run-hidden.vbs"));

if (process.argv.includes("--with-env")) {
  if (!existsSync(".env.local")) throw new Error("--with-env needs .env.local");
  const wanted = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => wanted.some((k) => l.startsWith(`${k}=`)));
  if (lines.length !== wanted.length) throw new Error(`.env.local is missing one of ${wanted.join(", ")}`);
  writeFileSync(join(OUT, "agent-worker.env"), "# PRIVATE - database service key. Do not share this kit outside the company.\n" + lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}/ (WITH agent-worker.env - keep this kit private)`);
} else {
  console.log(`Wrote ${OUT}/ (fill in agent-worker.env from agent-worker.env.example)`);
}
