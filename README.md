# Canvas Editor DevTools

[![中文](https://img.shields.io/badge/中文-README-blue)](README.zh-CN.md)

Chrome DevTools extension for debugging [Canvas Editor](https://github.com/Hufe921/canvas-editor).

## Features

### 1. Element Tree Inspector
- Real-time view of Canvas Editor document structure
- Support for main content, header, and footer zones
- Click elements to view detailed information (styles, attributes)

### 2. Event Monitor
- Real-time monitoring of Canvas Editor events
- Supported event types:
  - Content changes (contentChange)
  - Range style changes (rangeStyleChange)
  - Page-related events (visiblePageNoListChange, pageSizeChange, etc.)
  - Control events (controlChange, controlContentChange)
  - Image events (imageSizeChange, imageMousedown, etc.)
  - Mouse events (mousemove, click, etc.)
- Filter by category
- Auto-scrolling event log

### 3. Configuration Panel
- View and modify Canvas Editor configuration options
- Supported configurations:
  - Appearance settings (font, color, margins)
  - Watermark settings
  - Page number settings
  - Table default styles
  - Control styles
  - Cursor settings
  - Checkbox/Radio styles

## Installation

### Developer Mode

1. Open Chrome browser and visit `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select this project folder

## Usage

1. Open a webpage using Canvas Editor
2. Ensure the page has loaded the Canvas Editor instance (`window.__CANVAS_EDITOR_INSTANCE__`)
3. Press F12 to open Developer Tools
4. Find the "Canvas Editor" tab
5. Start using:
   - Elements panel: View document structure, click elements for details
   - Events panel: Enable event switches to monitor real-time events
   - Config panel: Modify configurations and save

## Development

1. After modifying code, click the refresh button on `chrome://extensions/` to reload
2. Changes to injected-script.js require refreshing the target page

## License

MIT
