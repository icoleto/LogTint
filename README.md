# LogTint

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](#-architecture)

**LogTint** is a lightweight Chrome extension that renders ANSI escape codes
(colors, bold, underline, etc.) found in plain-text log viewers as real,
styled text — live, as new log lines are added to the page.

If you've ever stared at raw log output like this in a browser-based log
viewer (CI dashboards, internal tools, `<pre>` panes fed by streaming logs...):

```
2026-09-11T06:56:51.9125815Z [32m[Nest] 1  - [39m09/11/2026, 8:56:51 AM [32m    LOG[39m [38;5;3m[AuthenticationCommon] [39m[32mAuthenticated user gigyaUid: f05487e821704cfb8c14c5e5d5e138c0[39m
```

...LogTint turns it into properly colored text, the same way a real terminal
would render it — automatically, with no configuration required.

## Features

- **Zero dependencies, no build step.** A small, self-contained ANSI SGR
  parser (see [`src/ansi-parser.js`](./src/ansi-parser.js)) — no bundler, no
  npm install, load the folder as-is.
- **Real-time rendering.** A `MutationObserver` watches the page for new or
  changed text nodes (e.g. streaming log output) and re-renders them the
  moment they appear, in addition to an initial scan of existing content.
- **Full ANSI SGR support.** 16-color, 256-color, and 24-bit truecolor
  foreground/background, plus bold, dim, italic, underline, strikethrough,
  and reverse video.
- **Safe by design.** All log text is HTML-escaped before being inserted;
  only internally generated `<span style="...">` markup is produced. Once a
  chunk is rendered, it no longer contains ANSI codes, so there's no
  reprocessing loop.
- **Per-site control.** A popup lets you toggle LogTint globally, disable it
  for the current site only, or trigger a manual re-scan of the page.

## Installation

LogTint isn't published on the Chrome Web Store yet — install it as an
unpacked extension:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `LogTint/` folder.
5. Done — LogTint is now active on all sites by default.

## Usage

LogTint works automatically: open any page containing raw ANSI escape
sequences in its text content, and they'll be rendered as colored/styled text
in real time — no action needed.

Use the toolbar popup to:
- Toggle LogTint on/off globally.
- Disable it for the site you're currently on.
- Force a manual re-scan of the current page (useful for edge cases like
  virtualized lists or content loaded before the observer attached).

## Try the demo

Open [`test/demo.html`](./test/demo.html) in your browser (with the
extension loaded) to see:
- A static log block using the same format produced by NestJS's built-in
  logger.
- A simulated streaming log (one new line per second) to verify that the
  `MutationObserver` colors content as it arrives.

## Tests

The parser ships with dependency-free unit tests (Node's built-in `assert`
and `vm` modules):

```bash
node test/ansi-parser.test.js
```

## Architecture

```
LogTint/
├── manifest.json          # Manifest V3 config
├── icons/                 # Extension icons
├── src/
│   ├── ansi-parser.js      # ANSI SGR -> HTML parser (no dependencies)
│   ├── content.js          # MutationObserver + DOM injection logic
│   └── styles.css          # Minimal styling for rendered content
├── popup/
│   ├── popup.html
│   ├── popup.js             # Global/per-site toggle, manual re-scan
│   └── popup.css
└── test/
    ├── ansi-parser.test.js
    └── demo.html
```

## Known limitations / roadmap

- Content inside `<textarea>` or `contenteditable` elements is not processed
  (styled HTML can't be inserted there).
- If a log grows by continuously mutating a single text node (rather than
  appending new nodes), the whole line is reprocessed on each change; very
  large single-line logs could benefit from incremental diffing.
- Sites using virtualized lists (rendering only visible rows) or closed
  Shadow DOM may need extra handling — use the popup's **Re-scan page**
  button as a quick workaround.
- Cross-origin iframes aren't processed (a Chrome extension limitation, not
  specific to this codebase).

## Security notes

- No `eval`, no remotely loaded scripts — everything ships inside the
  extension bundle and complies with a strict CSP (see
  [`popup/popup.html`](./popup/popup.html)).
- HTML inserted into the page is built exclusively from escaped text plus
  internally generated `style` attributes — never from attributes or markup
  found in the original log content.
- Permissions are kept minimal: `storage` (save preferences),
  `scripting`/`activeTab` (manual re-scan from the popup), and
  `host_permissions: <all_urls>` (required to detect logs on any site; you
  can disable the extension per-site from the popup).

## Contributing

Issues and pull requests are welcome. Please keep changes dependency-free and
add/update tests in [`test/ansi-parser.test.js`](./test/ansi-parser.test.js)
for any parser changes.

## License

[MIT](./LICENSE) © [icoleto](https://github.com/icoleto)
