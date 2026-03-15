# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome DevTools extension for debugging [Canvas Editor](https://github.com/Hufe921/canvas-editor). It provides an Element Tree inspector, Event Monitor, and Configuration Panel for Canvas Editor instances.

## Architecture

### Extension Structure (Manifest V3)

The extension follows a 5-layer communication architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│  DevTools Panel (panel.html/js/css)                             │
│  - UI for element tree, events, config                          │
├─────────────────────────────────────────────────────────────────┤
│  DevTools Page (devtools.html/js)                               │
│  - Registers the "Canvas Editor" panel in Chrome DevTools       │
├─────────────────────────────────────────────────────────────────┤
│  Background Service Worker (background.js)                      │
│  - Forwards messages between content script and DevTools        │
├─────────────────────────────────────────────────────────────────┤
│  Content Script (content-script.js)                             │
│  - Injected into all web pages; bridges page ↔ extension        │
├─────────────────────────────────────────────────────────────────┤
│  Injected Script (injected-script.js)                           │
│  - Injected into page context; accesses window.__CANVAS_EDITOR_INSTANCE__
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

- **injected-script.js**: Runs in the page context with direct access to the Canvas Editor instance. Wraps command methods (`execute*`, `get*`) for tracking, listens to events via `eventBus`, and serializes data for cross-context messaging.
- **content-script.js**: Injects `injected-script.js` into the page and forwards messages between the page and background script.
- **background.js**: Service worker that maintains connections and routes messages between DevTools and content scripts.
- **devtools.js**: Creates the DevTools panel when Chrome DevTools opens.
- **panel.js**: Main UI logic with three tabs: Elements (document tree), Events (real-time event log), Config (editor options editor).

### Communication Protocol

Messages use `postMessage` between contexts with the following type field:
- `EDITOR_DATA` - Editor state snapshot
- `EVENT_EMITTED` - Event from eventBus
- `COMMAND_EXECUTED`/`COMMAND_ERROR` - Command tracking
- `NEED_REFRESH_DATA` - Request to refresh tree

## Development Workflow

### No Build Step

This is a vanilla JavaScript project with no build process or dependencies. Files are loaded directly by Chrome.

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select this project folder

### Making Changes

- Changes to `background.js`, `devtools.js`, `panel.js`, `panel.html`, `panel.css`: Click the refresh button on `chrome://extensions/`
- Changes to `content-script.js`: Refresh the extension and reload the target page
- Changes to `injected-script.js`: Refresh the target page (this script is injected fresh on each page load)

### Testing

1. Open a webpage that uses Canvas Editor (must expose `window.__CANVAS_EDITOR_INSTANCE__`)
2. Press F12 to open Chrome DevTools
3. Select the "Canvas Editor" tab
4. The panel connects automatically when an editor instance is detected

### Data Serialization

The `safeSerialize()` function in `injected-script.js` handles cross-context data transfer:
- Removes non-cloneable objects (Promises, functions, DOM nodes, Window/Document)
- Skips private properties starting with `_`
- Has a max depth limit (default 3) to prevent circular reference issues

## File Reference

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (V3) |
| `devtools.html/js` | DevTools panel registration |
| `background.js` | Service worker message routing |
| `content-script.js` | Injects script and bridges contexts |
| `injected-script.js` | Page-context code accessing editor instance |
| `panel.html/js/css` | DevTools panel UI |
| `favicon.png` | Extension icon |
