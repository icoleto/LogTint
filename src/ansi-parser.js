/**
 * LogTint - ANSI SGR (Select Graphic Rendition) parser.
 *
 * Converts plain text containing ANSI escape sequences
 * (e.g. "\x1b[32mtext\x1b[39m") into safe HTML with <span>
 * elements and equivalent inline styles.
 *
 * Deliberately designed with no external dependencies:
 *  - Full control over HTML escaping (prevents XSS).
 *  - No build step: loads as-is, as a classic content script.
 *
 * Exposed as `window.LogTint.ansiToHtml` and `window.LogTint.containsAnsi`.
 */
(function (global) {
  "use strict";

  // ESC followed by "[" + numeric params separated by ";" + "m" (SGR).
  const SGR_REGEX = /\u001b\[([0-9;]*)m/g;

  // Standard 16-color palette (compatible with most terminals /
  // libraries such as chalk, pino-pretty, winston, Nest's logger, etc.)
  const BASE16 = [
    "#000000", "#e74c3c", "#2ecc71", "#f1c40f",
    "#3498db", "#9b59b6", "#1abc9c", "#bdc3c7",
    "#7f8c8d", "#ff6b6b", "#51e58e", "#ffe066",
    "#5dade2", "#c39bd3", "#48d1cc", "#ffffff"
  ];

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Converts a 0-255 index from the xterm 256-color palette to "#rrggbb".
  function color256(n) {
    n = Number(n);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    if (n < 16) return BASE16[n];
    if (n < 232) {
      const i = n - 16;
      const r = Math.floor(i / 36);
      const g = Math.floor((i % 36) / 6);
      const b = i % 6;
      const scale = (v) => (v === 0 ? 0 : 55 + v * 40);
      return rgbToHex(scale(r), scale(g), scale(b));
    }
    // Grayscale ramp (232-255)
    const gray = 8 + (n - 232) * 10;
    return rgbToHex(gray, gray, gray);
  }

  function rgbToHex(r, g, b) {
    const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function freshState() {
    return {
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      strike: false,
      hidden: false,
      reverse: false
    };
  }

  // Applies a list of SGR codes (already split by ";") onto the state.
  // Returns the updated state (mutated in place for simplicity/performance).
  function applySgrCodes(state, codes) {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      switch (code) {
        case 0:
          Object.assign(state, freshState());
          break;
        case 1:
          state.bold = true;
          break;
        case 2:
          state.dim = true;
          break;
        case 3:
          state.italic = true;
          break;
        case 4:
          state.underline = true;
          break;
        case 7:
          state.reverse = true;
          break;
        case 8:
          state.hidden = true;
          break;
        case 9:
          state.strike = true;
          break;
        case 22:
          state.bold = false;
          state.dim = false;
          break;
        case 23:
          state.italic = false;
          break;
        case 24:
          state.underline = false;
          break;
        case 27:
          state.reverse = false;
          break;
        case 28:
          state.hidden = false;
          break;
        case 29:
          state.strike = false;
          break;
        case 39:
          state.fg = null;
          break;
        case 49:
          state.bg = null;
          break;
        default:
          if (code >= 30 && code <= 37) {
            state.fg = BASE16[code - 30];
          } else if (code >= 90 && code <= 97) {
            state.fg = BASE16[8 + (code - 90)];
          } else if (code >= 40 && code <= 47) {
            state.bg = BASE16[code - 40];
          } else if (code >= 100 && code <= 107) {
            state.bg = BASE16[8 + (code - 100)];
          } else if (code === 38 || code === 48) {
            const isFg = code === 38;
            const mode = codes[i + 1];
            if (mode === 5) {
              const idx = codes[i + 2];
              const hex = color256(idx);
              if (hex) {
                if (isFg) state.fg = hex;
                else state.bg = hex;
              }
              i += 2;
            } else if (mode === 2) {
              const r = codes[i + 2] || 0;
              const g = codes[i + 3] || 0;
              const b = codes[i + 4] || 0;
              const hex = rgbToHex(r, g, b);
              if (isFg) state.fg = hex;
              else state.bg = hex;
              i += 4;
            }
          }
          // Unknown codes are silently ignored.
          break;
      }
    }
    return state;
  }

  function styleToCss(state) {
    let fg = state.fg;
    let bg = state.bg;
    if (state.reverse) {
      const tmp = fg;
      fg = bg || "#000000";
      bg = tmp || "#ffffff";
    }
    const decl = [];
    if (fg) decl.push(`color:${fg}`);
    if (bg) decl.push(`background-color:${bg}`);
    if (state.bold) decl.push("font-weight:bold");
    if (state.dim) decl.push("opacity:0.7");
    if (state.italic) decl.push("font-style:italic");
    const lines = [];
    if (state.underline) lines.push("underline");
    if (state.strike) lines.push("line-through");
    if (lines.length) decl.push(`text-decoration:${lines.join(" ")}`);
    if (state.hidden) decl.push("visibility:hidden");
    return decl.join(";");
  }

  function isStateDefault(state) {
    return (
      !state.fg &&
      !state.bg &&
      !state.bold &&
      !state.dim &&
      !state.italic &&
      !state.underline &&
      !state.strike &&
      !state.hidden &&
      !state.reverse
    );
  }

  function containsAnsi(text) {
    SGR_REGEX.lastIndex = 0;
    return SGR_REGEX.test(text);
  }

  // Converts text containing ANSI SGR codes into safe HTML (escaped text +
  // equivalent <span style="..."> markup). If the text contains no ANSI
  // codes, returns null so the caller can avoid touching the DOM.
  function ansiToHtml(text) {
    if (!containsAnsi(text)) return null;

    let state = freshState();
    let out = "";
    let lastIndex = 0;
    SGR_REGEX.lastIndex = 0;

    let match;
    while ((match = SGR_REGEX.exec(text)) !== null) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk) out += renderChunk(chunk, state);

      const codes = match[1].length
        ? match[1].split(";").map((n) => (n === "" ? 0 : parseInt(n, 10)))
        : [0];
      state = applySgrCodes(state, codes);

      lastIndex = SGR_REGEX.lastIndex;
    }

    const rest = text.slice(lastIndex);
    if (rest) out += renderChunk(rest, state);

    return out;
  }

  function renderChunk(chunk, state) {
    const escaped = escapeHtml(chunk);
    if (isStateDefault(state)) return escaped;
    const css = styleToCss(state);
    if (!css) return escaped;
    return `<span class="logtint-span" style="${css}">${escaped}</span>`;
  }

  global.LogTint = global.LogTint || {};
  global.LogTint.ansiToHtml = ansiToHtml;
  global.LogTint.containsAnsi = containsAnsi;
})(typeof window !== "undefined" ? window : globalThis);
