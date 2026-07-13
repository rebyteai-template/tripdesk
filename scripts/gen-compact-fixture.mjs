// Regenerate server/fixtures/compact-search-combo.json by running the real
// simplifly-flyai-skill CLI (sibling repo) against its own shopping fixture —
// no live API. Run whenever the compact wire format changes:
//   node scripts/gen-compact-fixture.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(HERE, "..", "..", "simplifly-flyai-skill");
const CLI = join(SKILL_ROOT, "skills", "simplifly-flyai-skill", "scripts", "flight.ts");
const OUT = join(HERE, "..", "server", "fixtures", "compact-search-combo.json");
const payload = JSON.parse(readFileSync(join(SKILL_ROOT, "evals/files/fixtures/shopping-response.json"), "utf-8"));

// spawnSync would block the event loop and starve the in-process fixture server.
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, opts);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const server = createServer((_, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(join(tmpdir(), "fixture-req-"));
const requestFile = join(dir, "request.json");
writeFileSync(requestFile, JSON.stringify({
  searches: [
    { label: "leg-1", body: { journeys: [{ origin: "SHA", destination: "LAX", departureDate: "2026-09-27" }], passengers: { adult: 1, child: 0, infant: 0 }, cabinClass: "economy" } },
    { label: "leg-2", body: { journeys: [{ origin: "LAX", destination: "SLC", departureDate: "2026-09-29" }], passengers: { adult: 1, child: 0, infant: 0 }, cabinClass: "economy" } },
  ],
}));

// Scratch HOME so a developer's ~/.simplifly.env cannot override the mock
// endpoint (config precedence is file-first).
const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "fixture-home-")) };
for (const k of Object.keys(env)) if (k.startsWith("SIMPLIFLY_")) delete env[k];
const result = await run(process.execPath, [CLI, "search", "--request-file", requestFile, "--top", "2"], {
  cwd: mkdtempSync(join(tmpdir(), "fixture-cwd-")),
  env: { ...env, SIMPLIFLY_BASE_URL: baseUrl, SIMPLIFLY_AUTH_TOKEN: "test-token", SIMPLIFLY_SESSION_ROOT: mkdtempSync(join(tmpdir(), "fixture-root-")) },
});
server.close();

if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}
const parsed = JSON.parse(result.stdout);
// Drop the machine-local session path; the UI never reads it.
delete parsed.sessionDir;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(parsed)}\n`);
console.log("wrote", OUT);
for (const o of parsed.displayOptions) {
  console.log(`#${o.optionNumber} ${o.solutionId} price=${o.price.amount} blocks=${JSON.stringify(o.blocks?.map((b) => [b.price.amount, b.source]))}`);
}
