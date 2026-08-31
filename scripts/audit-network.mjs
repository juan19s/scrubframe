#!/usr/bin/env node
/**
 * SPEC §7.4 — fails the build if anything capable of making a network request
 * survives into the shipped bundle.
 *
 * Crude on purpose: a grep over .output/ is something a skeptic can rerun in
 * five seconds without trusting our word for it.
 *
 * Two rules, deliberately different in strictness:
 *  - Network primitives are a hard failure, no exceptions. If one is in the
 *    bundle, the "zero network requests" claim is no longer verifiable by
 *    inspection, whatever the intent behind it was.
 *  - Remote URL strings fail unless listed in network-allowlist.json with a
 *    reason. A URL in a string is not a request, but it is worth having to
 *    justify each one in writing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = '.output';
const SCANNED = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json']);

/**
 * Dev builds legitimately carry a WebSocket back to the WXT dev server for hot
 * reload, and a localhost host permission to go with it. The claim being
 * audited is about what ships, so `.output/*-dev/` is out of scope — and saying
 * that out loud is better than a scan that quietly passes for the wrong reason.
 */
const isShipped = (name) => !name.endsWith('-dev');

const PRIMITIVES = [
  { name: 'fetch(', pattern: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', pattern: /\bWebSocket\b/g },
  { name: 'EventSource', pattern: /\bEventSource\b/g },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/g },
  { name: 'importScripts', pattern: /\bimportScripts\s*\(/g },
];

const URL_PATTERN = /https?:\/\/([\w.-]+)/g;

const here = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(readFileSync(join(here, 'network-allowlist.json'), 'utf8'));
const allowedHosts = new Set(allowlist.urls.map((entry) => entry.host));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** The build directories the shipped claim covers. */
function shippedRoots() {
  return readdirSync(ROOT)
    .filter((name) => isShipped(name))
    .map((name) => join(ROOT, name))
    .filter((path) => statSync(path).isDirectory());
}

function exists(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

if (!exists(ROOT)) {
  console.error(`No ${ROOT}/ directory. Run \`pnpm build\` first.`);
  process.exit(1);
}

const roots = shippedRoots();
const skipped = readdirSync(ROOT).filter((name) => !isShipped(name));

if (roots.length === 0) {
  console.error(`No shipped build under ${ROOT}/. Run \`pnpm build\` first.`);
  process.exit(1);
}

const violations = [];
const seenHosts = new Set();
let scanned = 0;

for (const file of roots.flatMap((root) => [...walk(root)])) {
  if (!SCANNED.has(extname(file))) continue;
  scanned += 1;
  const source = readFileSync(file, 'utf8');

  for (const rule of PRIMITIVES) {
    for (const match of source.matchAll(rule.pattern)) {
      violations.push({ file, rule: rule.name, detail: context(source, match.index) });
    }
  }

  for (const match of source.matchAll(URL_PATTERN)) {
    const host = match[1];
    seenHosts.add(host);
    if (!allowedHosts.has(host)) {
      violations.push({ file, rule: 'unlisted remote url', detail: match[0] });
    }
  }
}

/** 40 characters either side, so a reviewer can see what the match is doing. */
function context(source, index) {
  return source.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ');
}

if (violations.length > 0) {
  console.error(`Network audit FAILED — ${violations.length} finding(s):\n`);
  for (const v of violations) console.error(`  ${v.file}\n    ${v.rule}: ${v.detail}\n`);
  console.error('Remove the code above, or the "zero network requests" claim.');
  console.error('An inert URL string can be added to scripts/network-allowlist.json with a reason.');
  process.exit(1);
}

console.log(
  `Network audit passed — ${scanned} bundled file(s) across ${roots.join(', ')}, no network primitives.`,
);
if (skipped.length > 0) {
  console.log(`Not audited (dev builds, not shipped): ${skipped.join(', ')}`);
}
console.log(`Remote URL strings, all allowlisted: ${[...seenHosts].sort().join(', ') || 'none'}`);
