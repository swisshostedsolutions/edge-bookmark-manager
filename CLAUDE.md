# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 browser extension (Edge/Chrome) for exporting, importing, searching, and managing bookmarks and tab groups. Plain HTML/CSS/JS — no build step, no package manager, no bundler, no tests.

## Running / testing changes

There is no build or test command. To try changes:

1. Open `edge://extensions` (or `chrome://extensions`) and enable Developer mode.
2. "Load unpacked" and select this repo's root directory (the one containing `manifest.json`).
3. After editing `background.js`, click the extension's "Reload" button on the extensions page (service workers don't hot-reload).
4. After editing files under `popup/`, close and reopen the popup — no reload needed unless `manifest.json` changed.
5. Debug the popup via right-click on the toolbar icon → "Inspect popup". Debug the background service worker via the "service worker" link on the extension's card in `edge://extensions`.

## Architecture

Two-context extension with message passing between them — there is no shared module system, so data crossing the boundary is always plain JSON via `chrome.runtime.sendMessage`.

- **`background.js`** — the service worker. Holds all logic that touches `chrome.bookmarks`, `chrome.tabs`, `chrome.tabGroups`, and `chrome.downloads`. Exposes a single `chrome.runtime.onMessage` listener that dispatches on `msg.action` (`exportBookmarks`, `exportSelectedBookmarks`, `exportTabGroups`, `importBookmarks`, `importTabGroups`) to one async handler function per action. Every listener branch that calls an async handler must `return true` to keep the message channel open for the async `sendResponse`.
- **`popup/popup.js`** — the UI logic. Renders the live bookmark tree (`chrome.bookmarks.getTree()`) recursively into checkboxes (`loadTree`/`renderNode`), and wires each button/file-input to `chrome.runtime.sendMessage({action: ...})`. File imports are read client-side (`file.text()` → `JSON.parse`) before being sent to the background worker.
- **`popup/popup.html`** — static shell for the popup; loads `popup.js`.
- **`manifest.json`** — declares the MV3 service worker entry point, the popup entry point, and the required permissions (`bookmarks`, `tabs`, `tabGroups`, `storage`, `downloads`). Any new Chrome API used in `background.js` or `popup.js` must be added here or it will fail silently/throw at runtime.

### Export/import data format

Exports are JSON payloads, base64-encoded into a `data:application/json;base64,...` URL and saved via `chrome.downloads.download`:
- Full bookmark export: `{ version, exportedAt, tree }` — `tree` is the raw `chrome.bookmarks.getTree()` result.
- Selected bookmark export: `{ version, exportedAt, selection }` — `selection` is an array of subtrees from `chrome.bookmarks.getSubTree(id)` for each checked node.
- Tab group export: `{ exportedAt, groups }` — `groups` is an array of `{ title, color, tabs: [{title, url}] }`, built by grouping `chrome.tabs.query()` results by `tab.groupId`.

`importBookmarks` accepts either shape (`data.tree` or `data.selection`) and recreates the structure under a new "Imported Bookmarks" folder, recursing on `node.children` vs `node.url` to distinguish folders from leaf bookmarks. `importTabGroups` expects `{ groups }`, opens a new window, recreates each group's tabs, then groups and re-colors/titles them via `chrome.tabs.group` + `chrome.tabGroups.update`.

When adding a new export/import action: add the `msg.action` branch in `background.js`, add the corresponding handler function, and wire a UI trigger in `popup.js`/`popup.html` — the three always change together.
