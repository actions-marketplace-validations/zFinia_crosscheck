#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const OIDC_AUDIENCE = "https://api.zfinia.com/crosscheck";
export const AUTHORIZATION_ENDPOINT = "https://api.zfinia.com/v1/crosscheck/action/authorize";
export const ACTIVATION_URL = "https://www.zfinia.com/crosscheck/scan";

export async function authorizeAction({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.GITHUB_ACTIONS !== "true") throw new Error("CrossCheck managed authorization requires GitHub Actions.");
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("GitHub OIDC is unavailable. Grant the workflow `id-token: write` permission.");
  }
  const oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidcUrl.searchParams.set("audience", OIDC_AUDIENCE);
  const identityResponse = await fetchImpl(oidcUrl, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!identityResponse.ok) throw new Error(`GitHub OIDC request failed (${identityResponse.status}).`);
  const identity = await identityResponse.json();
  if (typeof identity.value !== "string" || !identity.value) throw new Error("GitHub OIDC response did not contain an identity token.");

  const response = await fetchImpl(AUTHORIZATION_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${identity.value}`, "Content-Type": "application/json" },
    body: "{}",
  });
  let result = {};
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok || result.authorized !== true) {
    const error = new Error(`CrossCheck continuous monitoring is not active for this repository.\nActivate this repository from:\n${ACTIVATION_URL}`);
    error.code = "CROSSCHECK_MONITORING_REQUIRED";
    throw error;
  }
  return { authorized: true, plan: typeof result.plan === "string" ? result.plan : "", repository: typeof result.repository === "string" ? result.repository : "" };
}

export function writeSafeOutputs(result, outputPath) {
  if (!outputPath) return;
  appendFileSync(outputPath, `authorized=true\nplan=${result.plan}\nrepository=${result.repository}\n`);
}

async function main() {
  try {
    const result = await authorizeAction();
    writeSafeOutputs(result, process.env.GITHUB_OUTPUT);
    console.log(`CrossCheck managed monitoring authorized${result.repository ? ` for ${result.repository}` : ""}.`);
  } catch (error) {
    console.error(`CrossCheck: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
