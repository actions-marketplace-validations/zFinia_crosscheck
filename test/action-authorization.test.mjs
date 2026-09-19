import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
