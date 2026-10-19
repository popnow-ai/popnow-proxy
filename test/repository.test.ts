import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/version.js";

// Compiled to dist/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);

/** Tracked files when this is a git checkout, otherwise every file outside build output. */
function repositoryFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tracked = out.split("\0").filter(Boolean);
    if (tracked.length > 0) return tracked;
  } catch {
    // Not a git checkout (for example an unpacked tarball): walk the tree instead.
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(ROOT, full));
    }
  };
  walk(ROOT);
  return files;
}

const files = repositoryFiles()
  .filter((file) => !/\.(png|jpe?g|webp|gif|ico)$/i.test(file) && file !== "package-lock.json")
  .filter((file) => file !== "REPO_META.json")
  .map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));

void test("reads enough files for the scans below to mean anything", () => {
  // A counter-check: a scan that silently read nothing would always pass.
  assert.ok(files.length >= 15, `only ${files.length} files were read`);
  assert.ok(files.some(({ file }) => file === "src/core.ts"));
});

void test("contains no CJK characters, so every file reads the same to every contributor", () => {
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;
  assert.deepEqual(
    files.filter(({ text }) => cjk.test(text)).map(({ file }) => file),
    [],
  );
});

void test("names no third-party model hosts or other services", () => {
  // Assembled from parts so this file does not match its own scan.
  const names = [
    ["wave", "speed"],
    ["atlas", "cloud"],
    ["kie", "\\.ai"],
    ["sp", "icy"],
    ["replic", "ate\\.com"],
    ["fal", "\\.ai"],
  ];
  const pattern = new RegExp(names.map((parts) => parts.join("")).join("|"), "i");
  assert.deepEqual(
    files.filter(({ text }) => pattern.test(text)).map(({ file }) => file),
    [],
  );
});

void test("never ships a real-looking API key", () => {
  const key = /sk-popnow-[0-9a-f]{48}/;
  assert.deepEqual(
    files.filter(({ text }) => key.test(text)).map(({ file }) => file),
    [],
  );
});

void test("the version sent in the User-Agent matches package.json", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});
