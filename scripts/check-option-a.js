#!/usr/bin/env node
/**
 * Option A enforcement: fail if admin.graphql appears outside allowed directories.
 * Allowed: app/lib/shopify-graphql.server.*, app/services/*
 * Usage: node scripts/check-option-a.js
 */

import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

const ALLOWED_PATTERNS = [
  (p) => p.replace(/\\/g, "/").includes("app/lib/shopify-graphql.server"),
  (p) => p.replace(/\\/g, "/").includes("app/services/"),
];

function getAllJsFiles(dir, list = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "dist") continue;
      getAllJsFiles(full, list);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
      list.push(rel);
    }
  }
  return list;
}

function isAllowed(filePath) {
  return ALLOWED_PATTERNS.some((fn) => fn(filePath));
}

const files = getAllJsFiles(join(root, "app"));
const violations = [];

for (const file of files) {
  if (isAllowed(file)) continue;
  const fullPath = join(root, file);
  let content;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch {
    continue;
  }
  if (content.includes("admin.graphql")) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error("Option A violation: admin.graphql must only appear in app/lib/shopify-graphql.server.* and app/services/*");
  violations.forEach((f) => console.error("  -", f));
  process.exit(1);
}

console.log("Option A check passed: no admin.graphql in routes or disallowed files.");
process.exit(0);
