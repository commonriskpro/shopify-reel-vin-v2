/**
 * Option A enforcement test: fail if admin.graphql appears outside
 * app/lib/shopify-graphql.server.* and app/services/*
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

const ALLOWED_PATTERNS = [
  (p) => p.replace(/\\/g, "/").includes("app/lib/shopify-graphql.server"),
  (p) => p.replace(/\\/g, "/").includes("app/services/"),
];

function getAllJsFiles(rootDir, dir, list = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(rootDir, full).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "dist") continue;
      getAllJsFiles(rootDir, full, list);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
      list.push(rel);
    }
  }
  return list;
}

function isAllowed(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return ALLOWED_PATTERNS.some((fn) => fn(normalized));
}

describe("Option A: admin.graphql only in lib/shopify-graphql.server.* and services/*", () => {
  it("no file under app/ outside allowed dirs contains admin.graphql", () => {
    const appDir = join(root, "app");
    const files = getAllJsFiles(root, appDir);
    const violations = [];
    for (const file of files) {
      if (isAllowed(file)) continue;
      try {
        const content = readFileSync(join(root, file), "utf8");
        if (content.includes("admin.graphql")) violations.push(file);
      } catch {
        // skip unreadable
      }
    }
    expect(violations).toEqual([]);
  });
});
