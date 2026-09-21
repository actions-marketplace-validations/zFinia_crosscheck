// Reads a JSONL file, transparently accepting a gzipped copy.
//
// The published raw scan is large, so it ships as `.jsonl.gz`. Every consumer
// goes through here so that re-running the analysis against the published
// evidence works without an extra decompression step.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function readJsonlText(path) {
  if (existsSync(path)) return readFileSync(path, "utf8");
  if (existsSync(path + ".gz")) return gunzipSync(readFileSync(path + ".gz")).toString("utf8");
  throw new Error(`missing: ${path} (and ${path}.gz)`);
}

export function readJsonl(path) {
  return readJsonlText(path)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export const jsonlExists = (path) => existsSync(path) || existsSync(path + ".gz");
