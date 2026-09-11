"use strict";
/**
 * Test unitario del parser ANSI de LogTint, sin dependencias externas.
 * Ejecutar con: node test/ansi-parser.test.js
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

// 1. Texto sin ANSI no se toca (devuelve null).
assert.strictEqual(containsAnsi("hola mundo"), false);
assert.strictEqual(ansiToHtml("hola mundo"), null);

// 2. Color básico de foreground (verde=32) y reset (39).
{
  const input = `${esc(32)}hola${esc(39)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("color:#2ecc71"), "debe aplicar color verde");
  assert.ok(html.includes(">hola<"), "debe mantener el texto");
}

// 3. Escapado de HTML para evitar XSS.
{
  const input = `${esc(31)}<img src=x onerror=alert(1)>${esc(0)}`;
  const html = ansiToHtml(input);
  assert.ok(!html.includes("<img"), "no debe inyectar HTML crudo");
  assert.ok(html.includes("&lt;img"), "debe escapar las etiquetas");
}

// 4. Color 256 (38;5;n) usado por Nest logger (código 3 = amarillo oliva).
{
  const input = `${esc("38;5;3")}[AuthenticationCommon] ${esc(39)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("color:"), "debe aplicar un color de la paleta 256");
}

// 5. Negrita + color combinados en el mismo código SGR.
{
  const input = `${esc("1;32")}OK${esc(0)}`;
  const html = ansiToHtml(input);
  assert.ok(html.includes("font-weight:bold"));
  assert.ok(html.includes("color:#2ecc71"));
}

// 6. Ejemplo real de log de NestJS pegado por el usuario.
{
  const input =
    "\u001b[32m[Nest] 1  - \u001b[39m09/11/2026, 8:56:51 AM \u001b[32m    LOG\u001b[39m " +
    "\u001b[38;5;3m[AuthenticationCommon] \u001b[39m\u001b[32mAuthenticated user " +
    "gigyaUid: f05487e821704cfb8c14c5e5d5e138c0\u001b[39m";
  const html = ansiToHtml(input);
  assert.ok(!html.includes("\u001b"), "no deben quedar códigos de escape sin procesar");
  assert.ok(html.includes("Authenticated user"), "debe conservar el contenido del log");
  assert.ok(html.match(/<span[^>]*color:#2ecc71/), "debe colorear en verde las partes marcadas");
}

console.log("Todos los tests de LogTint pasaron correctamente.");
