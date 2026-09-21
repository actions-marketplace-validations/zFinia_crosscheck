import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeAction, OIDC_AUDIENCE, AUTHORIZATION_ENDPOINT } from "../bin/action-authorize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Action authorization refuses missing GitHub OIDC environment", async () => {
  await assert.rejects(authorizeAction({ env: { GITHUB_ACTIONS: "true" }, fetchImpl: () => assert.fail("must not fetch") }), /id-token: write/);
});

test("Action authorization never exposes either bearer token", async () => {
  const secret = "github-request-secret";
  const oidc = "signed-oidc-secret";
  const calls = [];
  const result = await authorizeAction({
    env: { GITHUB_ACTIONS: "true", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.test/oidc", ACTIONS_ID_TOKEN_REQUEST_TOKEN: secret },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return new Response(JSON.stringify({ value: oidc }), { status: 200 });
      return new Response(JSON.stringify({ authorized: true, plan: "team", repository: "owner/repo" }), { status: 200 });
    },
  });
  assert.deepEqual(result, { authorized: true, plan: "team", repository: "owner/repo" });
  assert.equal(new URL(calls[0].url).searchParams.get("audience"), OIDC_AUDIENCE);
  assert.equal(calls[1].url, AUTHORIZATION_ENDPOINT);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${secret}|${oidc}`));
});

test("Action, README, and CI describe and enforce the managed boundary", () => {
  const action = readFileSync(join(ROOT, "action.yml"), "utf8");
  assert.match(action, /action-authorize\.mjs/);
  assert.match(action, /CROSSCHECK_MANAGED_MONITORING_AUTHORIZED/);
  assert.ok(action.indexOf("action-authorize.mjs") < action.indexOf("id: crosscheck"));
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  for (const command of ["npm install --ignore-scripts", "npm test", "git diff --check", "npm pack --dry-run"]) assert.match(ci, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /id-token: write/);
  assert.match(readme, /managed monitoring/i);
});

// --- Adoption guarantees (v0.2 regression) -------------------------------
// v0.2 introduced an unconditional authorization step that exited 1 when the
// repository was not a managed customer, which failed the whole job for every
// free adopter. These tests keep the free path working.

test("a repository without managed monitoring is never failed by the Action", async () => {
  const outFile = join(tmpdir(), `cc-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(outFile, "");
  const run = spawnSync(process.execPath, [join(ROOT, "bin", "action-authorize.mjs")], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_OUTPUT: outFile,
           ACTIONS_ID_TOKEN_REQUEST_URL: "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  });
  assert.equal(run.status, 0, "the authorization step must exit 0 so it cannot fail an adopter's build");
  assert.match(readFileSync(outFile, "utf8"), /authorized=false/);
  rmSync(outFile, { force: true });
});

test("managed authorization is opt-in, so the default Action makes no network call", () => {
  const action = readFileSync(join(ROOT, "action.yml"), "utf8");
  assert.match(action, /managed-monitoring:/, "an explicit opt-in input must exist");
  // The authorization step must be guarded by that input.
  const step = action.slice(action.indexOf("- id: authorize"), action.indexOf("- id: crosscheck"));
  assert.match(step, /if:\s*inputs\.managed-monitoring == 'true'/,
    "the authorization step must be gated behind managed-monitoring: true");
  // And it must default to off.
  const input = action.slice(action.indexOf("managed-monitoring:"), action.indexOf("working-directory:"));
  assert.match(input, /default:\s*"false"/);
});

test("the Marketplace-facing description stays in plain English", () => {
  const action = readFileSync(join(ROOT, "action.yml"), "utf8");
  const description = /^description:\s*(.+)$/m.exec(action)[1].trim();
  assert.equal(description, "Warns when a pull request adds a lockfile that contradicts your package manager.");
  for (const jargon of ["decision contract", "Enforces repository"]) {
    assert.ok(!description.includes(jargon), `Marketplace description must not say "${jargon}"`);
  }
});
