"use strict";
/**
 * Unit tests for LogTint's ANSI parser, with no external dependencies.
 * Run with: node test/ansi-parser.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "ansi-parser.js"),
  "utf8"
);

const sandbox = { window: {}, globalThis: undefined };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { ansiToHtml, containsAnsi } = sandbox.window.LogTint;

function esc(codes) {
  return `\u001b[${codes}m`;
}

// 1. Text without ANSI codes is left untouched (returns null).
assert.strictEqual(containsAnsi("hello world"), false);
assert.strictEqual(ansiToHtml("hello world"), null);

// 2. Basic foreground color (green=32) and reset (39).
{
  const input = `${esc(32)}hello${esc(39)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("color:#2ecc71"), "should apply green color");
  assert.ok(html.includes(">hello<"), "should preserve the text");
}

// 3. HTML escaping to prevent XSS.
{
  const input = `${esc(31)}<img src=x onerror=alert(1)>${esc(0)}`;
  const html = ansiToHtml(input);
  assert.ok(!html.includes("<img"), "should not inject raw HTML");
  assert.ok(html.includes("&lt;img"), "should escape tags");
}

// 4. 256-color mode (38;5;n) used by NestJS's logger (code 3 = olive/yellow).
{
  const input = `${esc("38;5;3")}[AuthenticationCommon] ${esc(39)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("color:"), "should apply a color from the 256 palette");
}

// 5. Bold + color combined in the same SGR code.
{
  const input = `${esc("1;32")}OK${esc(0)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("font-weight:bold"));
  assert.ok(html.includes("color:#2ecc71"));
}

// 6. Real-world NestJS log line example.
{
  const input =
    "\u001b[32m[Nest] 1  - \u001b[39m09/11/2026, 8:56:51 AM \u001b[32m    LOG\u001b[39m " +
    "\u001b[38;5;3m[AuthenticationCommon] \u001b[39m\u001b[32mAuthenticated user " +
    "gigyaUid: f05487e821704cfb8c14c5e5d5e138c0\u001b[39m";
  const html = ansiToHtml(input);
  assert.ok(!html.includes("\u001b"), "no escape codes should remain unprocessed");
  assert.ok(html.includes("Authenticated user"), "should preserve the log content");
  assert.ok(html.match(/<span[^>]*color:#2ecc71/), "should color the marked parts in green");
}

console.log("All LogTint tests passed successfully.");
