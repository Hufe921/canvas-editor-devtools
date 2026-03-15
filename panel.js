// Canvas Editor DevTools - Panel Logic
// Element Tree, Event Monitor

(function () {
  'use strict'

  // ============ Global State ============
  const state = {
    connected: false,
    editorData: null,
    eventLog: [],
    currentTab: 'elements',
    selectedZone: 'main',
    scriptHistory: []
  }

  // ============ DOM Element Cache ============
  const dom = {}

  // ============ Element Tree Cache ============
  const currentElementMap = new Map()
  const expandedElements = new Set() // Set of expanded element IDs
  let selectedElementId = null // Currently selected element ID

  // ============ Message Debounce ============
  const messageDedupMap = new Map()
  const MESSAGE_DEDUP_MS = 100

  function isDuplicateMessage(key) {
    const now = Date.now()
    const lastTime = messageDedupMap.get(key)
    if (lastTime && now - lastTime < MESSAGE_DEDUP_MS) {
      return true
    }
    messageDedupMap.set(key, now)
    // Clean up old records
    messageDedupMap.forEach((time, k) => {
      if (now - time > MESSAGE_DEDUP_MS) {
        messageDedupMap.delete(k)
      }
    })
    return false
  }

  // ============ Initialization ============
  function init() {
    cacheDOM()
    bindEvents()
    connectToBackground()
    startConnectionCheck()
    loadScriptHistory()
  }

  // Connect to background script to receive event messages
  function connectToBackground() {
    try {
      if (!chrome.runtime) {
        return
      }

      // Use onMessage to listen for messages from background
      chrome.runtime.onMessage.addListener(function (message) {
        // De-duplication: only process identical events once within 100ms
        if (message.type === 'EVENT_EMITTED' && message.payload) {
          const dedupKey = `${message.payload.event}_${message.payload.timestamp || Date.now()}`
          if (isDuplicateMessage(dedupKey)) {
            return
          }
          handleEventEmitted(message.payload)
          // Refresh element tree data on contentChange
          if (message.payload.event === 'contentChange') {
            refreshData()
          }
        } else if (message.type === 'NEED_REFRESH_DATA') {
          refreshData()
        }
      })

      // Establish long connection for registering tabId
      const port = chrome.runtime.connect({ name: 'canvas-editor-devtools' })

      // Get current inspected window's tabId and register
      const tabId = chrome.devtools.inspectedWindow.tabId
      if (tabId) {
        port.postMessage({ type: 'REGISTER_TAB', tabId: tabId })
      }
    } catch (e) {
      // ignore
    }
  }

  function cacheDOM() {
    // Toolbar
    dom.connectionStatus = document.getElementById('connection-status')

    // Tabs
    dom.tabBtns = document.querySelectorAll('.tab-btn')
    dom.tabContents = document.querySelectorAll('.tab-content')

    // Element Panel
    dom.elementZone = document.getElementById('element-zone')
    dom.elementTree = document.getElementById('element-tree')
    dom.elementDetails = document.getElementById('element-details')

    // Event Panel
    dom.monitorContent = document.getElementById('monitor-content')
    dom.monitorRange = document.getElementById('monitor-range')
    dom.monitorPage = document.getElementById('monitor-page')
    dom.monitorControl = document.getElementById('monitor-control')
    dom.monitorMouse = document.getElementById('monitor-mouse')
    dom.monitorInput = document.getElementById('monitor-input')
    dom.monitorImage = document.getElementById('monitor-image')
    dom.monitorOther = document.getElementById('monitor-other')
    dom.eventLog = document.getElementById('event-log')
    dom.eventCount = document.getElementById('event-count')
    dom.btnClearEvents = document.getElementById('btn-clear-events')

    // Config Panel
    dom.configForm = document.getElementById('config-form')
    dom.configError = document.getElementById('config-error')
    dom.btnRefreshConfig = document.getElementById('btn-refresh-config')
    dom.btnSaveConfig = document.getElementById('btn-save-config')

    // Script Panel
    dom.scriptInput = document.getElementById('script-input')
    dom.scriptOutput = document.getElementById('script-output')
    dom.scriptStatus = document.getElementById('script-status')
    dom.btnExecuteScript = document.getElementById('btn-execute-script')
    dom.btnClearScript = document.getElementById('btn-clear-script')
    dom.historyList = document.getElementById('history-list')
    dom.btnClearHistory = document.getElementById('btn-clear-history')
  }

  function bindEvents() {
    // Tab switching
    dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    })

    // Element Panel
    dom.elementZone?.addEventListener('change', e => {
      state.selectedZone = e.target.value
      refreshElementTree()
    })

    // Event Panel
    dom.btnClearEvents?.addEventListener('click', () => {
      state.eventLog = []
      updateEventLog()
    })

    // Config Panel
    dom.btnRefreshConfig?.addEventListener('click', () => refreshConfig())
    dom.btnSaveConfig?.addEventListener('click', () => saveConfig())

    // Script Panel
    dom.btnExecuteScript?.addEventListener('click', () => executeScript())
    dom.btnClearScript?.addEventListener('click', () => clearScript())
    dom.btnClearHistory?.addEventListener('click', () => clearScriptHistory())

    // History item click
    dom.historyList?.addEventListener('click', (e) => {
      const historyItem = e.target.closest('.history-item')
      if (historyItem && historyItem.dataset.script) {
        dom.scriptInput.value = historyItem.dataset.script
      }
    })

    // Color input event - remove transparent class when selecting color
    document.querySelectorAll('input[type="color"]').forEach(input => {
      input.addEventListener('input', (e) => {
        if (e.target.value) {
          e.target.classList.remove('transparent')
        }
      })
    })
  }

  // ============ Connection Management ============
  function startConnectionCheck() {
    checkConnection()
    // Only check connection status, don't auto-refresh data
    setInterval(checkConnection, 2000)
  }

  function checkConnection() {
    chrome.devtools.inspectedWindow.eval(
      `!!window.__CANVAS_EDITOR_INSTANCE__`,
      function (hasEditor, exceptionInfo) {
        if (exceptionInfo) {
          updateConnectionStatus(false, null)
          return
        }

        if (hasEditor) {
          chrome.devtools.inspectedWindow.eval(
            `window.__CANVAS_EDITOR_INSTANCE__.version`,
            function (version, exceptionInfo) {
              updateConnectionStatus(true, {
                version: exceptionInfo ? 'unknown' : version
              })
            }
          )
        } else {
          updateConnectionStatus(false, null)
        }
      }
    )
  }

  function updateConnectionStatus(connected, data) {
    state.connected = connected

    if (connected) {
      dom.connectionStatus.textContent = `Connected (${data?.version || 'unknown'})`
      dom.connectionStatus.classList.remove('disconnected')
      dom.connectionStatus.classList.add('connected')

      // Only refresh once on first connection when no data
      if (!state.editorData) {
        refreshData()
      }
    } else {
      dom.connectionStatus.textContent = 'Not Connected'
      dom.connectionStatus.classList.remove('connected')
      dom.connectionStatus.classList.add('disconnected')
    }
  }

  // ============ Data Fetching ============
  function refreshData() {
    if (!state.connected) return

    const getDataScript = `
      (function() {
        const editor = window.__CANVAS_EDITOR_INSTANCE__;
        if (!editor) return null;

        function safeSerialize(obj, maxDepth = 3, currentDepth = 0) {
          if (currentDepth > maxDepth) return '[Max Depth]';
          if (obj === null || obj === undefined) return obj;
          if (typeof obj === 'function') return '[Function]';
          if (obj instanceof Promise) return '[Promise]';
          if (obj instanceof HTMLElement) return '[HTMLElement]';
          if (obj instanceof Node) return '[Node]';
          if (obj instanceof Window) return '[Window]';
          if (obj instanceof Document) return '[Document]';
          if (Array.isArray(obj)) {
            return obj.map(item => safeSerialize(item, maxDepth, currentDepth + 1));
          }
          if (obj instanceof Date) return obj.toISOString();
          if (obj instanceof RegExp) return obj.toString();
          if (typeof obj === 'object') {
            const result = {};
            try {
              for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                  if (key.startsWith('_')) continue;
                  try {
                    const value = obj[key];
                    result[key] = safeSerialize(value, maxDepth, currentDepth + 1);
                  } catch (e) {
                    result[key] = '[Error: ' + e.message + ']';
                  }
                }
              }
            } catch (e) {
              return '[Object Error]';
            }
            return result;
          }
          return obj;
        }

        try {
          const command = editor.command;

          let value = null;
          try {
            value = command.getValue ? command.getValue() : null;
          } catch (e) {}

          const data = value?.data || value || {};

          const elementsOnly = {
            main: (data.main || []).slice(0, 100),
            header: (data.header || []).slice(0, 50),
            footer: (data.footer || []).slice(0, 50)
          };

          const safeElements = safeSerialize(elementsOnly, 10);

          return {
            version: editor.version,
            data: safeElements
          };
        } catch (e) {
          return { version: editor.version, data: { main: [], header: [], footer: [] } };
        }
      })()
    `

    chrome.devtools.inspectedWindow.eval(
      getDataScript,
      function (data, exceptionInfo) {
        if (exceptionInfo) {
          return
        }
        if (data) {
          handleEditorData(data)
        }
      }
    )
  }

  function handleEditorData(data) {
    state.editorData = data

    if (!data) {
      return
    }

    if (state.currentTab === 'elements') {
      refreshElementTree()
    }
  }

  // ============ Element Tree Panel ============
  function refreshElementTree() {
    if (!state.editorData) {
      return
    }

    const elements = state.editorData.data[state.selectedZone] || []

    if (elements.length === 0) {
      dom.elementTree.innerHTML = `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <div class="message">No Elements</div>
          <div class="hint">No elements to display in current area</div>
        </div>
      `
      return
    }

    // Save currently selected element ID
    const selectedItem = dom.elementTree.querySelector('.tree-item.selected')
    const savedSelectedId = selectedItem?.dataset.id || selectedElementId

    // Clear and re-collect elements
    currentElementMap.clear()
    collectElements(elements)

    dom.elementTree.innerHTML = renderElementTree(elements, 0)

    // Use event delegation to bind click events
    dom.elementTree.addEventListener('click', handleTreeItemClick)

    // Restore previously selected element
    if (savedSelectedId) {
      const itemToSelect = dom.elementTree.querySelector(`[data-id="${savedSelectedId}"]`)
      if (itemToSelect) {
        const element = currentElementMap.get(savedSelectedId)
        if (element) {
          selectElement(itemToSelect, element)
        }
      }
    }
  }

  function collectElements(elements, parentId = '') {
    elements.forEach((el, index) => {
      const id = parentId ? `${parentId}-${index}` : String(index)
      el._devtoolsId = id
      currentElementMap.set(id, el)

      // Collect child elements
      let children = []
      if (el.trList) {
        el.trList.forEach(tr => {
          if (tr.tdList) {
            tr.tdList.forEach(td => {
              if (td.value) children.push(...td.value)
            })
          }
        })
      } else if (el.control?.elementList) {
        children = el.control.elementList
      }

      if (children.length > 0) {
        collectElements(children, id)
      }
    })
  }

  function handleTreeItemClick(e) {
    const item = e.target.closest('.tree-item')
    if (!item) return

    const id = item.dataset.id
    const element = currentElementMap.get(id)
    if (!element) return

    // Determine if has child elements
    const hasChildren = element.trList || element.control?.elementList

    // If toggle icon clicked, switch expand/collapse state
    if (e.target.closest('.toggle') && hasChildren) {
      e.stopPropagation()
      toggleElementExpand(id)
      return
    }

    // Click entire item, select element and show details
    e.stopPropagation()
    selectElement(item, element)
  }

  function toggleElementExpand(id) {
    if (expandedElements.has(id)) {
      expandedElements.delete(id)
    } else {
      expandedElements.add(id)
    }
    // Re-render tree to reflect expand state changes
    refreshElementTree()
  }

  function renderElementTree(elements, level = 0) {
    if (!elements || elements.length === 0) {
      return `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <div class="message">No Elements</div>
        </div>
      `
    }

    return elements
      .map(el => {
        const indent = level * 16
        const icon = getElementIcon(el.type)
        // Handle both value and valueList cases
        let displayValue = ''
        if (el.value) {
          displayValue = el.value
        } else if (el.valueList?.length > 0) {
          displayValue = el.valueList.map(v => v.value || '').join('')
        }
        const value = displayValue ? truncate(displayValue, 20) : ''
        const hasChildren = el.trList || el.control?.elementList
        const isExpanded = expandedElements.has(el._devtoolsId)
        const toggleClass = isExpanded ? 'toggle expanded' : 'toggle'
        const toggleIcon = hasChildren ? (isExpanded ? '▼' : '▶') : ''

        return `
        <div class="tree-item" data-id="${el._devtoolsId}" style="padding-left: ${indent}px">
          <span class="${toggleClass}">${toggleIcon}</span>
          <span class="icon">${icon}</span>
          <span class="name">${el.type || 'text'}</span>
          ${el.type ? `<span class="type">${el.type}</span>` : ''}
          ${value ? `<span class="value">"${escapeHtml(value)}"</span>` : ''}
        </div>
        ${hasChildren && isExpanded ? renderElementChildren(el, level + 1) : ''}
      `
      })
      .join('')
  }

  function renderElementChildren(el, level) {
    let children = []
    if (el.trList) {
      el.trList.forEach(tr => {
        if (tr.tdList) {
          tr.tdList.forEach(td => {
            if (td.value) children.push(...td.value)
          })
        }
      })
    } else if (el.control?.elementList) {
      children = el.control.elementList
    }

    if (children.length === 0) return ''

    return `<div class="tree-children">${renderElementTree(children, level)}</div>`
  }

  // SVG icons for element types
  const svgIcons = {
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
    hyperlink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    checkbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
    latex: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17V7l-5 5"/></svg>',
    separator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    pageBreak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="4" y1="13" x2="20" y2="13"/></svg>',
    control: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    title: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/></svg>',
    block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>'
  }

  function getElementIcon(type) {
    return svgIcons[type] || svgIcons.default
  }

  function selectElement(item, element) {
    if (!element) return

    dom.elementTree.querySelectorAll('.tree-item').forEach(el => {
      el.classList.remove('selected')
    })
    item.classList.add('selected')

    // Save selected element ID
    selectedElementId = item.dataset.id

    dom.elementDetails.innerHTML = renderElementDetails(element)
  }

  function renderElementDetails(el) {
    const sections = []

    // 1. Basic Info - shown for all types
    // Handle both value and valueList cases
    let displayValue = el.value
    if (!displayValue && el.valueList?.length > 0) {
      displayValue = el.valueList.map(v => v.value || '').join('')
    }
    const basicRows = [
      { label: 'ID', value: el.id },
      { label: 'Type', value: el.type || 'text' },
      { label: 'Value', value: displayValue },
      { label: 'External ID', value: el.externalId },
      { label: 'Hidden', value: el.hide }
    ]
    if (el.extension !== undefined) {
      basicRows.push({
        label: 'Extension',
        value:
          typeof el.extension === 'object'
            ? JSON.stringify(el.extension)
            : el.extension
      })
    }
    sections.push({
      title: 'Basic Info',
      rows: basicRows.filter(r => r.value !== undefined)
    })

    // 2. Text Style
    const styleRows = []
    if (el.font !== undefined) styleRows.push({ label: 'Font', value: el.font })
    if (el.size !== undefined) styleRows.push({ label: 'Font Size', value: el.size })
    if (el.width !== undefined)
      styleRows.push({ label: 'Width', value: el.width })
    if (el.height !== undefined)
      styleRows.push({ label: 'Height', value: el.height })
    if (el.bold !== undefined) styleRows.push({ label: 'Bold', value: el.bold })
    if (el.color !== undefined)
      styleRows.push({ label: 'Color', value: el.color })
    if (el.highlight !== undefined)
      styleRows.push({ label: 'Highlight', value: el.highlight })
    if (el.italic !== undefined)
      styleRows.push({ label: 'Italic', value: el.italic })
    if (el.underline !== undefined)
      styleRows.push({ label: 'Underline', value: el.underline })
    if (el.strikeout !== undefined)
      styleRows.push({ label: 'Strikethrough', value: el.strikeout })
    if (el.rowFlex !== undefined)
      styleRows.push({ label: 'Alignment', value: el.rowFlex })
    if (el.rowMargin !== undefined)
      styleRows.push({ label: 'Line Spacing', value: el.rowMargin })
    if (el.letterSpacing !== undefined)
      styleRows.push({ label: 'Letter Spacing', value: el.letterSpacing })
    if (styleRows.length > 0) {
      sections.push({ title: 'Text Style', rows: styleRows })
    }

    // 3. Table Details
    if (el.type === 'table' && el.trList) {
      const tableRows = [
        { label: 'Row Count', value: el.trList.length },
        { label: 'Column Count', value: el.colgroup?.length || 'unknown' },
        { label: 'Border Type', value: el.borderType },
        { label: 'Border Color', value: el.borderColor },
        { label: 'Border Width', value: el.borderWidth },
        { label: 'Table Tool Disabled', value: el.tableToolDisabled },
        { label: 'Concept ID', value: el.conceptId }
      ].filter(r => r.value !== undefined)
      sections.push({ title: 'Table Properties', rows: tableRows })
    }

    // 4. Hyperlink
    if (el.type === 'hyperlink' || el.url !== undefined) {
      const linkRows = [{ label: 'URL', value: el.url }]
      if (el.valueList?.length > 0) {
        const linkText = el.valueList.map(v => v.value || '').join('')
        linkRows.push({ label: 'Link Text', value: linkText })
        linkRows.push({ label: 'Content Element Count', value: el.valueList.length })
      }
      sections.push({
        title: 'Hyperlink',
        rows: linkRows.filter(r => r.value !== undefined)
      })
    }

    // 5. Image Details
    if (el.type === 'image') {
      const imgRows = [
        { label: 'Width', value: el.width },
        { label: 'Height', value: el.height },
        { label: 'Display Mode', value: el.imgDisplay },
        { label: 'Tool Disabled', value: el.imgToolDisabled },
        { label: 'Preview Disabled', value: el.imgPreviewDisabled }
      ]
      if (el.imgFloatPosition) {
        imgRows.push({
          label: 'Float Position',
          value: `x:${el.imgFloatPosition.x}, y:${el.imgFloatPosition.y}`
        })
        if (el.imgFloatPosition.pageNo !== undefined) {
          imgRows.push({ label: 'Page Number', value: el.imgFloatPosition.pageNo })
        }
      }
      if (el.imgCrop) {
        imgRows.push({
          label: 'Crop',
          value: `x:${el.imgCrop.x}, y:${el.imgCrop.y}, ${el.imgCrop.width}x${el.imgCrop.height}`
        })
      }
      if (el.imgCaption) {
        imgRows.push({ label: 'Caption', value: el.imgCaption.value })
        if (el.imgCaption.color)
          imgRows.push({ label: 'Caption Color', value: el.imgCaption.color })
        if (el.imgCaption.font)
          imgRows.push({ label: 'Caption Font', value: el.imgCaption.font })
        if (el.imgCaption.size)
          imgRows.push({ label: 'Caption Font Size', value: el.imgCaption.size })
      }
      sections.push({
        title: 'Image Properties',
        rows: imgRows.filter(r => r.value !== undefined)
      })
    }

    // 6. Control Details
    if (el.control) {
      const controlRows = [
        { label: 'Type', value: el.control.type },
        { label: 'Placeholder', value: el.control.placeholder },
        { label: 'Group ID', value: el.control.groupId },
        { label: 'Concept ID', value: el.control.conceptId },
        { label: 'Prefix', value: el.control.prefix },
        { label: 'Suffix', value: el.control.postfix },
        { label: 'Pre-text', value: el.control.preText },
        { label: 'Post-text', value: el.control.postText },
        { label: 'Minimum Width', value: el.control.minWidth },
        { label: 'Underline', value: el.control.underline },
        { label: 'Border', value: el.control.border },
        { label: 'Code', value: el.control.code },
        { label: 'Minimum Value', value: el.control.min },
        { label: 'Maximum Value', value: el.control.max },
        { label: 'Direction', value: el.control.flexDirection },
        { label: 'Date Format', value: el.control.dateFormat },
        { label: 'Multi-select', value: el.control.isMultiSelect },
        { label: 'Multi-select Delimiter', value: el.control.multiSelectDelimiter },
        {
          label: 'Delete Disabled',
          value: el.control.deletable === false ? true : undefined
        },
        { label: 'Disabled', value: el.control.disabled },
        { label: 'Paste Disabled', value: el.control.pasteDisabled },
        { label: 'Hidden', value: el.control.hide }
      ].filter(r => r.value !== undefined)

      // Show option set details
      if (el.control.valueSets?.length > 0) {
        const valueSetsStr = el.control.valueSets
          .map(vs => `${vs.value}(${vs.code})`)
          .join(', ')
        controlRows.push({
          label: `Option Set(${el.control.valueSets.length})`,
          value: valueSetsStr
        })
      }

      // Show control value
      if (el.control.value?.length > 0) {
        const valueStr = el.control.value.map(v => v.value || '').join('')
        controlRows.push({ label: 'Current Value', value: valueStr })
      }

      sections.push({ title: 'Control Properties', rows: controlRows })
    }

    // 7. Checkbox
    if (el.type === 'checkbox' || el.checkbox) {
      const checkboxRows = [{ label: 'Selected', value: el.checkbox?.value }]
      // If it's a control-type checkbox, show options
      if (el.control?.valueSets?.length > 0) {
        const options = el.control.valueSets
          .map(vs => `${vs.value}(${vs.code})`)
          .join(', ')
        checkboxRows.push({ label: 'Options', value: options })
        if (el.control.code) {
          const selected = el.control.valueSets.find(
            vs => vs.code === el.control.code
          )
          checkboxRows.push({
            label: 'Current Option',
            value: selected ? selected.value : ''
          })
        }
      }
      sections.push({
        title: 'Checkbox',
        rows: checkboxRows.filter(r => r.value !== undefined)
      })
    }

    // 8. Radio
    if (el.type === 'radio' || el.radio) {
      const radioRows = [{ label: 'Selected', value: el.radio?.value }]
      // If it's a control-type radio, show options
      if (el.control?.valueSets?.length > 0) {
        const options = el.control.valueSets
          .map(vs => `${vs.value}(${vs.code})`)
          .join(', ')
        radioRows.push({ label: 'Options', value: options })
        if (el.control.code) {
          const selected = el.control.valueSets.find(
            vs => vs.code === el.control.code
          )
          radioRows.push({
            label: 'Current Option',
            value: selected ? selected.value : ''
          })
        }
      }
      sections.push({
        title: 'Radio',
        rows: radioRows.filter(r => r.value !== undefined)
      })
    }

    // 9. LaTeX
    if (el.type === 'latex') {
      const latexRows = [{ label: 'Formula', value: el.value }]
      if (el.laTexSVG) {
        latexRows.push({ label: 'SVG', value: 'Rendered' })
      }
      sections.push({
        title: 'LaTeX',
        rows: latexRows.filter(r => r.value !== undefined)
      })
    }

    // 10. Separator
    if (el.type === 'separator') {
      const sepRows = []
      if (el.dashArray !== undefined)
        sepRows.push({ label: 'Dash Array', value: el.dashArray.join(', ') })
      if (el.lineWidth !== undefined)
        sepRows.push({ label: 'Line Width', value: el.lineWidth })
      if (sepRows.length > 0) sections.push({ title: 'Separator', rows: sepRows })
    }

    // 11. Date
    if (el.type === 'date' || el.dateFormat !== undefined) {
      sections.push({
        title: 'Date',
        rows: [{ label: 'Format', value: el.dateFormat }]
      })
    }

    // 12. Title
    if (el.level !== undefined || el.title) {
      const titleRows = [{ label: 'Level', value: el.level }]
      if (el.valueList?.length > 0) {
        const titleText = el.valueList.map(v => v.value || '').join('')
        titleRows.push({ label: 'Title Content', value: titleText })
      }
      if (el.title?.conceptId)
        titleRows.push({ label: 'Concept ID', value: el.title.conceptId })
      if (el.title?.deletable !== undefined)
        titleRows.push({ label: 'Deletable', value: el.title.deletable })
      if (el.title?.disabled !== undefined)
        titleRows.push({ label: 'Disabled', value: el.title.disabled })
      sections.push({
        title: 'Title',
        rows: titleRows.filter(r => r.value !== undefined)
      })
    }

    // 13. List
    if (el.listType !== undefined || el.type === 'list') {
      const listRows = [
        { label: 'Type', value: el.listType },
        { label: 'Style', value: el.listStyle },
        { label: 'Wrap', value: el.listWrap }
      ]
      if (el.valueList?.length > 0) {
        const listContent = el.valueList.map(v => v.value || '').join('\n')
        listRows.push({ label: 'List Content', value: listContent })
      }
      sections.push({
        title: 'List',
        rows: listRows.filter(r => r.value !== undefined)
      })
    }

    // 14. Content Block (iframe/video)
    if (el.block) {
      const blockRows = [{ label: 'Type', value: el.block.type }]
      if (el.block.iframeBlock) {
        if (el.block.iframeBlock.src)
          blockRows.push({ label: 'Src', value: el.block.iframeBlock.src })
        if (el.block.iframeBlock.srcdoc)
          blockRows.push({ label: 'Srcdoc', value: 'Has Content' })
      }
      if (el.block.videoBlock?.src) {
        blockRows.push({ label: 'Video URL', value: el.block.videoBlock.src })
      }
      sections.push({ title: 'Content Block', rows: blockRows })
    }

    // 15. Area
    if (el.areaId !== undefined || el.area) {
      const areaRows = [{ label: 'ID', value: el.areaId }]
      if (el.area) {
        if (el.area.top !== undefined)
          areaRows.push({ label: 'Top', value: el.area.top })
        if (el.area.hide !== undefined)
          areaRows.push({ label: 'Hidden', value: el.area.hide })
        if (el.area.borderColor)
          areaRows.push({ label: 'Border Color', value: el.area.borderColor })
        if (el.area.backgroundColor)
          areaRows.push({ label: 'Background Color', value: el.area.backgroundColor })
        if (el.area.mode) areaRows.push({ label: 'Mode', value: el.area.mode })
      }
      sections.push({
        title: 'Area',
        rows: areaRows.filter(r => r.value !== undefined)
      })
    }

    // 16. Label
    if (el.labelId !== undefined || el.label) {
      const labelRows = [{ label: 'ID', value: el.labelId }]
      if (el.label) {
        if (el.label.color)
          labelRows.push({ label: 'Color', value: el.label.color })
        if (el.label.backgroundColor)
          labelRows.push({ label: 'Background Color', value: el.label.backgroundColor })
        if (el.label.borderRadius !== undefined)
          labelRows.push({ label: 'Border Radius', value: el.label.borderRadius })
      }
      sections.push({
        title: 'Label',
        rows: labelRows.filter(r => r.value !== undefined)
      })
    }

    // 17. Group
    if (el.groupIds?.length > 0) {
      sections.push({
        title: 'Group',
        rows: [{ label: 'Group IDs', value: el.groupIds.join(', ') }]
      })
    }

    return sections
      .map(
        section => `
      <div class="detail-section">
        <div class="detail-section-title">${section.title}</div>
        ${section.rows
          .map(
            row => `
          <div class="detail-row">
            <div class="detail-label">${row.label}</div>
            <div class="detail-value ${getValueType(row.value)}">${formatValue(row.value)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    `
      )
      .join('')
  }

  function getValueType(value) {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return ''
  }

  function formatValue(value) {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return `"${escapeHtml(value)}"`
    return String(value)
  }

  // ============ Configuration Panel ============
  function refreshConfig() {
    if (!state.connected) {
      showConfigError('Editor not connected')
      return
    }

    const getOptionsScript = `
      (function() {
        const editor = window.__CANVAS_EDITOR_INSTANCE__;
        if (!editor || !editor.command) return null;
        try {
          return editor.command.getOptions ? editor.command.getOptions() : null;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `

    chrome.devtools.inspectedWindow.eval(
      getOptionsScript,
      function (options, exceptionInfo) {
        if (exceptionInfo) {
          showConfigError('Failed to get config: ' + exceptionInfo.description)
          return
        }
        if (options && options.error) {
          showConfigError('Error getting config: ' + options.error)
          return
        }
        if (options) {
          fillConfigForm(options)
          hideConfigError()
        } else {
          showConfigError('Cannot get configuration, please check editor version')
        }
      }
    )
  }

  function fillConfigForm(options) {
    // Appearance
    setInputValue('cfg-defaultFont', options.defaultFont)
    setInputValue('cfg-defaultSize', options.defaultSize)
    setInputValue('cfg-defaultColor', options.defaultColor)
    setInputValue('cfg-defaultType', options.defaultType)
    setInputValue('cfg-minSize', options.minSize)
    setInputValue('cfg-maxSize', options.maxSize)
    setInputValue('cfg-defaultRowMargin', options.defaultRowMargin)
    setInputValue('cfg-defaultBasicRowMarginHeight', options.defaultBasicRowMarginHeight)
    setInputValue('cfg-defaultTabWidth', options.defaultTabWidth)
    setInputValue('cfg-margins', options.margins ? JSON.stringify(options.margins) : '')
    setInputValue('cfg-maskMargin', options.maskMargin ? JSON.stringify(options.maskMargin) : '')
    setInputValue('cfg-underlineColor', options.underlineColor)
    setInputValue('cfg-strikeoutColor', options.strikeoutColor)
    setInputValue('cfg-resizerColor', options.resizerColor)
    setInputValue('cfg-resizerSize', options.resizerSize)
    setInputValue('cfg-marginIndicatorColor', options.marginIndicatorColor)
    setInputValue('cfg-marginIndicatorSize', options.marginIndicatorSize)
    setInputValue('cfg-defaultHyperlinkColor', options.defaultHyperlinkColor)
    setInputValue('cfg-inactiveAlpha', options.inactiveAlpha)
    setInputValue('cfg-historyMaxRecordCount', options.historyMaxRecordCount)
    setSelectValue('cfg-wordBreak', options.wordBreak)
    setInputValue('cfg-printPixelRatio', options.printPixelRatio)
    setInputValue('cfg-rangeMinWidth', options.rangeMinWidth)

    // Default is break-word, if no value set default
    const wordBreakValue = options.wordBreak || 'break-word'
    setSelectValue('cfg-wordBreak', wordBreakValue)

    // Features
    setCheckboxValue('cfg-contextMenuDisabled', options.contextMenuDisableKeys?.length > 0)
    setCheckboxValue('cfg-pageOuterSelectionDisabled', options.pageOuterSelectionDisabled)

    // Watermark
    const watermark = options.watermark || {}
    setInputValue('cfg-watermark-data', watermark.data !== undefined ? watermark.data : '')
    setInputValue('cfg-watermark-color', watermark.color !== undefined ? watermark.color : '#AEB5C0')
    setInputValue('cfg-watermark-size', watermark.size !== undefined ? watermark.size : 200)
    setInputValue('cfg-watermark-opacity', watermark.opacity !== undefined ? watermark.opacity : 0.3)
    setInputValue('cfg-watermark-font', watermark.font !== undefined ? watermark.font : 'Microsoft YaHei')
    setCheckboxValue('cfg-watermark-repeat', watermark.repeat !== undefined ? watermark.repeat : false)

    // Page Number
    const pageNumber = options.pageNumber || {}
    setInputValue('cfg-pageNumber-format', pageNumber.format !== undefined ? pageNumber.format : '{pageNo}')
    setInputValue('cfg-pageNumber-bottom', pageNumber.bottom !== undefined ? pageNumber.bottom : 60)
    setInputValue('cfg-pageNumber-size', pageNumber.size !== undefined ? pageNumber.size : 12)
    setInputValue('cfg-pageNumber-color', pageNumber.color !== undefined ? pageNumber.color : '#000000')
    setSelectValue('cfg-pageNumber-rowFlex', pageNumber.rowFlex !== undefined ? pageNumber.rowFlex : 'center')
    setCheckboxValue('cfg-pageNumber-disabled', pageNumber.disabled !== undefined ? pageNumber.disabled : false)

    // Placeholder
    const placeholder = options.placeholder || {}
    setInputValue('cfg-placeholder-data', placeholder.data !== undefined ? placeholder.data : '')
    setInputValue('cfg-placeholder-color', placeholder.color !== undefined ? placeholder.color : '#DCDFE6')
    setInputValue('cfg-placeholder-opacity', placeholder.opacity !== undefined ? placeholder.opacity : 1)
    setInputValue('cfg-placeholder-size', placeholder.size !== undefined ? placeholder.size : 16)
    setInputValue('cfg-placeholder-font', placeholder.font !== undefined ? placeholder.font : 'Microsoft YaHei')

    // Search & Highlight
    setInputValue('cfg-searchMatchColor', options.searchMatchColor)
    setInputValue('cfg-searchNavigateMatchColor', options.searchNavigateMatchColor)
    setInputValue('cfg-searchMatchAlpha', options.searchMatchAlpha)
    setInputValue('cfg-rangeColor', options.rangeColor)
    setInputValue('cfg-rangeAlpha', options.rangeAlpha)
    setInputValue('cfg-highlightAlpha', options.highlightAlpha)

    // Table - default fill
    const table = options.table || {}
    setInputValue('cfg-table-borderColor', table.defaultBorderColor !== undefined ? table.defaultBorderColor : '#000000')
    setInputValue('cfg-table-cellMinWidth', table.defaultColMinWidth !== undefined ? table.defaultColMinWidth : 40)
    setInputValue('cfg-table-cellMinHeight', table.defaultTrMinHeight !== undefined ? table.defaultTrMinHeight : 42)
    setCheckboxValue('cfg-table-overflow', table.overflow !== undefined ? table.overflow : true)

    // Zone - default is true (disable hint)
    const zone = options.zone || {}
    setCheckboxValue('cfg-zone-tipDisabled', zone.tipDisabled !== undefined ? zone.tipDisabled : true)

    // Checkbox
    const checkbox = options.checkbox || {}
    setInputValue('cfg-checkbox-width', checkbox.width !== undefined ? checkbox.width : 14)
    setInputValue('cfg-checkbox-height', checkbox.height !== undefined ? checkbox.height : 14)
    setInputValue('cfg-checkbox-gap', checkbox.gap !== undefined ? checkbox.gap : 5)
    setInputValue('cfg-checkbox-lineWidth', checkbox.lineWidth !== undefined ? checkbox.lineWidth : 1)
    setInputValue('cfg-checkbox-fillStyle', checkbox.fillStyle !== undefined ? checkbox.fillStyle : '#ffffff')
    setInputValue('cfg-checkbox-strokeStyle', checkbox.strokeStyle !== undefined ? checkbox.strokeStyle : '#000000')
    setInputValue('cfg-checkbox-checkFillStyle', checkbox.checkFillStyle !== undefined ? checkbox.checkFillStyle : '#5175f4')
    setInputValue('cfg-checkbox-checkStrokeStyle', checkbox.checkStrokeStyle !== undefined ? checkbox.checkStrokeStyle : '#5175f4')
    setInputValue('cfg-checkbox-checkMarkColor', checkbox.checkMarkColor !== undefined ? checkbox.checkMarkColor : '#ffffff')
    setSelectValue('cfg-checkbox-verticalAlign', checkbox.verticalAlign !== undefined ? checkbox.verticalAlign : 'bottom')

    // Radio
    const radio = options.radio || {}
    setInputValue('cfg-radio-width', radio.width !== undefined ? radio.width : 14)
    setInputValue('cfg-radio-height', radio.height !== undefined ? radio.height : 14)
    setInputValue('cfg-radio-gap', radio.gap !== undefined ? radio.gap : 5)
    setInputValue('cfg-radio-lineWidth', radio.lineWidth !== undefined ? radio.lineWidth : 1)
    setInputValue('cfg-radio-fillStyle', radio.fillStyle !== undefined ? radio.fillStyle : '#5175f4')
    setInputValue('cfg-radio-strokeStyle', radio.strokeStyle !== undefined ? radio.strokeStyle : '#000000')
    setSelectValue('cfg-radio-verticalAlign', radio.verticalAlign !== undefined ? radio.verticalAlign : 'bottom')

    // Group
    const group = options.group || {}
    setInputValue('cfg-group-backgroundColor', group.backgroundColor !== undefined ? group.backgroundColor : '#E99D00')
    setInputValue('cfg-group-opacity', group.opacity !== undefined ? group.opacity : 0.1)
    setInputValue('cfg-group-activeBackgroundColor', group.activeBackgroundColor !== undefined ? group.activeBackgroundColor : '#E99D00')
    setInputValue('cfg-group-activeOpacity', group.activeOpacity !== undefined ? group.activeOpacity : 0.5)
    setCheckboxValue('cfg-group-disabled', group.disabled !== undefined ? group.disabled : false)
    setCheckboxValue('cfg-group-deletable', group.deletable !== undefined ? group.deletable : true)

    // Page Break
    const pageBreak = options.pageBreak || {}
    setInputValue('cfg-pageBreak-font', pageBreak.font !== undefined ? pageBreak.font : 'Microsoft YaHei')
    setInputValue('cfg-pageBreak-fontSize', pageBreak.fontSize !== undefined ? pageBreak.fontSize : 12)

    // Background
    const background = options.background || {}
    setInputValue('cfg-background-color', background.color !== undefined ? background.color : '#FFFFFF')

    // Line Break - default disabled: true
    const lineBreak = options.lineBreak || {}
    setCheckboxValue('cfg-lineBreak-disabled', lineBreak.disabled !== undefined ? lineBreak.disabled : true)
    setInputValue('cfg-lineBreak-color', lineBreak.color !== undefined ? lineBreak.color : '#CCCCCC')
    setInputValue('cfg-lineBreak-lineWidth', lineBreak.lineWidth !== undefined ? lineBreak.lineWidth : 1.5)

    // Whitespace - default disabled: true
    const whiteSpace = options.whiteSpace || {}
    setCheckboxValue('cfg-whiteSpace-disabled', whiteSpace.disabled !== undefined ? whiteSpace.disabled : true)
    setInputValue('cfg-whiteSpace-color', whiteSpace.color !== undefined ? whiteSpace.color : '#CCCCCC')
    setInputValue('cfg-whiteSpace-radius', whiteSpace.radius !== undefined ? whiteSpace.radius : 1)

    // Line Number - default disabled: true
    const lineNumber = options.lineNumber || {}
    setCheckboxValue('cfg-lineNumber-disabled', lineNumber.disabled !== undefined ? lineNumber.disabled : true)
    setInputValue('cfg-lineNumber-size', lineNumber.size !== undefined ? lineNumber.size : 12)
    setInputValue('cfg-lineNumber-font', lineNumber.font !== undefined ? lineNumber.font : 'Microsoft YaHei')
    setInputValue('cfg-lineNumber-color', lineNumber.color !== undefined ? lineNumber.color : '#000000')
    setInputValue('cfg-lineNumber-right', lineNumber.right !== undefined ? lineNumber.right : 20)
    setSelectValue('cfg-lineNumber-type', lineNumber.type !== undefined ? lineNumber.type : 'continuity')

    // Page Border - default disabled: true
    const pageBorder = options.pageBorder || {}
    setCheckboxValue('cfg-pageBorder-disabled', pageBorder.disabled !== undefined ? pageBorder.disabled : true)
    setInputValue('cfg-pageBorder-color', pageBorder.color !== undefined ? pageBorder.color : '#000000')
    setInputValue('cfg-pageBorder-lineWidth', pageBorder.lineWidth !== undefined ? pageBorder.lineWidth : 1)

    // Superscript
    const badge = options.badge || {}
    setInputValue('cfg-badge-top', badge.top !== undefined ? badge.top : 0)
    setInputValue('cfg-badge-left', badge.left !== undefined ? badge.left : 5)

    // Graffiti
    const graffiti = options.graffiti || {}
    setInputValue('cfg-graffiti-defaultLineColor', graffiti.defaultLineColor !== undefined ? graffiti.defaultLineColor : '#000000')
    setInputValue('cfg-graffiti-defaultLineWidth', graffiti.defaultLineWidth !== undefined ? graffiti.defaultLineWidth : 2)

    // Label
    const label = options.label || {}
    setInputValue('cfg-label-defaultColor', label.defaultColor !== undefined ? label.defaultColor : '#1976d2')
    setInputValue('cfg-label-defaultBackgroundColor', label.defaultBackgroundColor !== undefined ? label.defaultBackgroundColor : '#e3f2fd')
    setInputValue('cfg-label-defaultBorderRadius', label.defaultBorderRadius !== undefined ? label.defaultBorderRadius : 4)

    // Image Caption
    const imgCaption = options.imgCaption || {}
    setInputValue('cfg-imgCaption-color', imgCaption.color !== undefined ? imgCaption.color : '#666666')
    setInputValue('cfg-imgCaption-font', imgCaption.font !== undefined ? imgCaption.font : 'Microsoft YaHei')
    setInputValue('cfg-imgCaption-size', imgCaption.size !== undefined ? imgCaption.size : 12)
    setInputValue('cfg-imgCaption-top', imgCaption.top !== undefined ? imgCaption.top : 5)

    // List - default inheritStyle: false
    const list = options.list || {}
    setCheckboxValue('cfg-list-inheritStyle', list.inheritStyle !== undefined ? list.inheritStyle : false)

    // Control - fill actual values (including empty string)
    const control = options.control || {}
    setInputValue('cfg-control-prefix', control.prefix !== undefined ? control.prefix : '{')
    setInputValue('cfg-control-postfix', control.postfix !== undefined ? control.postfix : '}')
    setInputValue('cfg-control-borderColor', control.borderColor !== undefined ? control.borderColor : '#000000')
    setInputValue('cfg-control-borderWidth', control.borderWidth !== undefined ? control.borderWidth : 1)
    setInputValue('cfg-control-placeholderColor', control.placeholderColor !== undefined ? control.placeholderColor : '#9c9b9b')
    setInputValue('cfg-control-bracketColor', control.bracketColor !== undefined ? control.bracketColor : '#000000')
    // Following properties default to empty string
    setInputValue('cfg-control-activeBackgroundColor', control.activeBackgroundColor !== undefined ? control.activeBackgroundColor : '')
    setInputValue('cfg-control-disabledBackgroundColor', control.disabledBackgroundColor !== undefined ? control.disabledBackgroundColor : '')
    setInputValue('cfg-control-existValueBackgroundColor', control.existValueBackgroundColor !== undefined ? control.existValueBackgroundColor : '')
    setInputValue('cfg-control-noValueBackgroundColor', control.noValueBackgroundColor !== undefined ? control.noValueBackgroundColor : '')

    // Cursor
    const cursor = options.cursor || {}
    setInputValue('cfg-cursor-color', cursor.color !== undefined ? cursor.color : '#000000')
    setInputValue('cfg-cursor-width', cursor.width !== undefined ? cursor.width : 1)
    setInputValue('cfg-cursor-dragWidth', cursor.dragWidth !== undefined ? cursor.dragWidth : 2)
    setInputValue('cfg-cursor-dragColor', cursor.dragColor !== undefined ? cursor.dragColor : '#0000FF')
    setCheckboxValue('cfg-cursor-dragFloatImageDisabled', cursor.dragFloatImageDisabled !== undefined ? cursor.dragFloatImageDisabled : false)

    // Title
    const title = options.title || {}
    setInputValue('cfg-title-level1', title.defaultFirstSize !== undefined ? title.defaultFirstSize : 26)
    setInputValue('cfg-title-level2', title.defaultSecondSize !== undefined ? title.defaultSecondSize : 24)
    setInputValue('cfg-title-level3', title.defaultThirdSize !== undefined ? title.defaultThirdSize : 22)
    setInputValue('cfg-title-level4', title.defaultFourthSize !== undefined ? title.defaultFourthSize : 20)
    setInputValue('cfg-title-level5', title.defaultFifthSize !== undefined ? title.defaultFifthSize : 18)
    setInputValue('cfg-title-level6', title.defaultSixthSize !== undefined ? title.defaultSixthSize : 16)

    // Header & Footer
    const header = options.header || {}
    setInputValue('cfg-header-maxHeight', header.maxHeight !== undefined ? header.maxHeight : 60)
    setCheckboxValue('cfg-header-disabled', header.disabled !== undefined ? header.disabled : false)
    const footer = options.footer || {}
    setInputValue('cfg-footer-maxHeight', footer.maxHeight !== undefined ? footer.maxHeight : 60)
    setCheckboxValue('cfg-footer-disabled', footer.disabled !== undefined ? footer.disabled : false)

    // Lines
    setInputValue('cfg-underlineColor', options.underlineColor)
    setInputValue('cfg-strikeoutColor', options.strikeoutColor)
    if (options.separator) {
      setInputValue('cfg-separator-color', options.separator.color)
    }
    if (options.pageBreak) {
      setInputValue('cfg-pageBreak-color', options.pageBreak.color)
    }

    // Other
    setInputValue('cfg-resizerColor', options.resizerColor)
    setInputValue('cfg-resizerSize', options.resizerSize)
    setInputValue('cfg-defaultHyperlinkColor', options.defaultHyperlinkColor)
    setInputValue('cfg-inactiveAlpha', options.inactiveAlpha)
    setSelectValue('cfg-wordBreak', options.wordBreak)
    setInputValue('cfg-printPixelRatio', options.printPixelRatio)
  }

  function setSelectValue(id, value) {
    const el = document.getElementById(id)
    if (el && value !== undefined && value !== null) {
      el.value = value
    }
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id)
    if (!el) return
    // If value is undefined/null/empty string, set empty value
    if (value === undefined || value === null || value === '') {
      el.value = ''
      // For color input, add transparent class to show transparent style
      if (el.type === 'color') {
        el.classList.add('transparent')
      }
    } else {
      el.value = value
      if (el.type === 'color') {
        el.classList.remove('transparent')
      }
    }
  }

  function setCheckboxValue(id, checked) {
    const el = document.getElementById(id)
    if (el && checked !== undefined) {
      el.checked = checked
    }
  }

  function saveConfig() {
    if (!state.connected) {
      showConfigError('Editor not connected')
      return
    }

    const options = collectConfigFromForm()
    const updateOptionsScript = `
      (function() {
        const editor = window.__CANVAS_EDITOR_INSTANCE__;
        if (!editor || !editor.command) return { error: 'Editor not initialized' };
        try {
          if (editor.command.executeUpdateOptions) {
            editor.command.executeUpdateOptions(${JSON.stringify(options)});
            return { success: true };
          } else {
            return { error: 'executeUpdateOptions method does not exist' };
          }
        } catch (e) {
          return { error: e.message };
        }
      })()
    `

    chrome.devtools.inspectedWindow.eval(
      updateOptionsScript,
      function (result, exceptionInfo) {
        if (exceptionInfo) {
          showConfigError('Failed to save config: ' + exceptionInfo.description)
          return
        }
        if (result && result.error) {
          showConfigError('Error saving config: ' + result.error)
          return
        }
        if (result && result.success) {
          hideConfigError()
          dom.btnSaveConfig.textContent = 'Saved'
          setTimeout(() => {
            dom.btnSaveConfig.innerHTML = `
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save
            `
          }, 1000)
        }
      }
    )
  }

  function collectConfigFromForm() {
    const options = {}

    // Appearance
    const defaultFont = getInputValue('cfg-defaultFont')
    if (defaultFont) options.defaultFont = defaultFont

    const defaultSize = getNumberValue('cfg-defaultSize')
    if (defaultSize !== null) options.defaultSize = defaultSize

    const defaultColor = getInputValue('cfg-defaultColor')
    if (defaultColor) options.defaultColor = defaultColor

    const defaultType = getInputValue('cfg-defaultType')
    if (defaultType) options.defaultType = defaultType

    const minSize = getNumberValue('cfg-minSize')
    if (minSize !== null) options.minSize = minSize

    const maxSize = getNumberValue('cfg-maxSize')
    if (maxSize !== null) options.maxSize = maxSize

    const defaultRowMargin = getNumberValue('cfg-defaultRowMargin')
    if (defaultRowMargin !== null) options.defaultRowMargin = defaultRowMargin

    const defaultBasicRowMarginHeight = getNumberValue('cfg-defaultBasicRowMarginHeight')
    if (defaultBasicRowMarginHeight !== null) options.defaultBasicRowMarginHeight = defaultBasicRowMarginHeight

    const defaultTabWidth = getNumberValue('cfg-defaultTabWidth')
    if (defaultTabWidth !== null) options.defaultTabWidth = defaultTabWidth

    const margins = parseMargins(getInputValue('cfg-margins'))
    if (margins) options.margins = margins

    const maskMargin = parseMargins(getInputValue('cfg-maskMargin'))
    if (maskMargin) options.maskMargin = maskMargin

    const underlineColor = getInputValue('cfg-underlineColor')
    if (underlineColor) options.underlineColor = underlineColor

    const strikeoutColor = getInputValue('cfg-strikeoutColor')
    if (strikeoutColor) options.strikeoutColor = strikeoutColor

    const resizerColor = getInputValue('cfg-resizerColor')
    if (resizerColor) options.resizerColor = resizerColor

    const resizerSize = getNumberValue('cfg-resizerSize')
    if (resizerSize !== null) options.resizerSize = resizerSize

    const marginIndicatorColor = getInputValue('cfg-marginIndicatorColor')
    if (marginIndicatorColor) options.marginIndicatorColor = marginIndicatorColor

    const marginIndicatorSize = getNumberValue('cfg-marginIndicatorSize')
    if (marginIndicatorSize !== null) options.marginIndicatorSize = marginIndicatorSize

    const defaultHyperlinkColor = getInputValue('cfg-defaultHyperlinkColor')
    if (defaultHyperlinkColor) options.defaultHyperlinkColor = defaultHyperlinkColor

    const inactiveAlpha = getNumberValue('cfg-inactiveAlpha')
    if (inactiveAlpha !== null) options.inactiveAlpha = inactiveAlpha

    const historyMaxRecordCount = getNumberValue('cfg-historyMaxRecordCount')
    if (historyMaxRecordCount !== null) options.historyMaxRecordCount = historyMaxRecordCount

    const rangeMinWidth = getNumberValue('cfg-rangeMinWidth')
    if (rangeMinWidth !== null) options.rangeMinWidth = rangeMinWidth

    const wordBreak = document.getElementById('cfg-wordBreak')?.value
    if (wordBreak) options.wordBreak = wordBreak

    const printPixelRatio = getNumberValue('cfg-printPixelRatio')
    if (printPixelRatio !== null) options.printPixelRatio = printPixelRatio

    // Features
    if (document.getElementById('cfg-contextMenuDisabled')?.checked) {
      options.contextMenuDisableKeys = ['*']
    }
    if (document.getElementById('cfg-pageOuterSelectionDisabled')?.checked) {
      options.pageOuterSelectionDisabled = true
    }

    // Watermark
    const watermarkData = getInputValue('cfg-watermark-data')
    if (watermarkData) {
      options.watermark = {
        data: watermarkData,
        color: getInputValue('cfg-watermark-color') || '#AEB5C0',
        size: getNumberValue('cfg-watermark-size') || 120,
        opacity: getNumberValue('cfg-watermark-opacity') || 0.3,
        font: getInputValue('cfg-watermark-font') || 'Microsoft YaHei',
        repeat: document.getElementById('cfg-watermark-repeat')?.checked || false
      }
    }

    // Page Number
    const pageNumberFormat = getInputValue('cfg-pageNumber-format')
    const pageNumberBottom = getNumberValue('cfg-pageNumber-bottom')
    const pageNumberSize = getNumberValue('cfg-pageNumber-size')
    const pageNumberColor = getInputValue('cfg-pageNumber-color')
    const pageNumberRowFlex = document.getElementById('cfg-pageNumber-rowFlex')?.value
    const pageNumberDisabled = document.getElementById('cfg-pageNumber-disabled')?.checked
    if (pageNumberFormat || pageNumberBottom !== null || pageNumberSize !== null || pageNumberColor || pageNumberRowFlex || pageNumberDisabled !== undefined) {
      options.pageNumber = {}
      if (pageNumberFormat) options.pageNumber.format = pageNumberFormat
      if (pageNumberBottom !== null) options.pageNumber.bottom = pageNumberBottom
      if (pageNumberSize !== null) options.pageNumber.size = pageNumberSize
      if (pageNumberColor) options.pageNumber.color = pageNumberColor
      if (pageNumberRowFlex) options.pageNumber.rowFlex = pageNumberRowFlex
      if (pageNumberDisabled !== undefined) options.pageNumber.disabled = pageNumberDisabled
    }

    // Placeholder
    const placeholderData = getInputValue('cfg-placeholder-data')
    const placeholderOpacity = getNumberValue('cfg-placeholder-opacity')
    const placeholderSize = getNumberValue('cfg-placeholder-size')
    const placeholderFont = getInputValue('cfg-placeholder-font')
    if (placeholderData || placeholderOpacity !== null || placeholderSize !== null || placeholderFont) {
      options.placeholder = {
        data: placeholderData || 'Please enter content',
        color: getInputValue('cfg-placeholder-color') || '#DCDFE6'
      }
      if (placeholderOpacity !== null) options.placeholder.opacity = placeholderOpacity
      if (placeholderSize !== null) options.placeholder.size = placeholderSize
      if (placeholderFont) options.placeholder.font = placeholderFont
    }

    // Search & Highlight
    const searchMatchColor = getInputValue('cfg-searchMatchColor')
    if (searchMatchColor) options.searchMatchColor = searchMatchColor

    const searchNavigateMatchColor = getInputValue('cfg-searchNavigateMatchColor')
    if (searchNavigateMatchColor) options.searchNavigateMatchColor = searchNavigateMatchColor

    const searchMatchAlpha = getNumberValue('cfg-searchMatchAlpha')
    if (searchMatchAlpha !== null) options.searchMatchAlpha = searchMatchAlpha

    const rangeColor = getInputValue('cfg-rangeColor')
    if (rangeColor) options.rangeColor = rangeColor

    const rangeAlpha = getNumberValue('cfg-rangeAlpha')
    if (rangeAlpha !== null) options.rangeAlpha = rangeAlpha

    const highlightAlpha = getNumberValue('cfg-highlightAlpha')
    if (highlightAlpha !== null) options.highlightAlpha = highlightAlpha

    // Table
    const tableBorderColor = getInputValue('cfg-table-borderColor')
    const tableCellMinWidth = getNumberValue('cfg-table-cellMinWidth')
    const tableCellMinHeight = getNumberValue('cfg-table-cellMinHeight')
    const tableOverflow = document.getElementById('cfg-table-overflow')?.checked
    if (tableBorderColor || tableCellMinWidth !== null || tableCellMinHeight !== null || tableOverflow !== undefined) {
      options.table = {}
      if (tableBorderColor) options.table.defaultBorderColor = tableBorderColor
      if (tableCellMinWidth !== null) options.table.defaultColMinWidth = tableCellMinWidth
      if (tableCellMinHeight !== null) options.table.defaultTrMinHeight = tableCellMinHeight
      if (tableOverflow !== undefined) options.table.overflow = tableOverflow
    }

    // Control
    const controlPrefix = getInputValue('cfg-control-prefix')
    const controlPostfix = getInputValue('cfg-control-postfix')
    const controlBorderColor = getInputValue('cfg-control-borderColor')
    const controlBorderWidth = getNumberValue('cfg-control-borderWidth')
    const controlPlaceholderColor = getInputValue('cfg-control-placeholderColor')
    const controlBracketColor = getInputValue('cfg-control-bracketColor')
    const controlActiveBackgroundColor = getInputValue('cfg-control-activeBackgroundColor')
    const controlDisabledBackgroundColor = getInputValue('cfg-control-disabledBackgroundColor')
    const controlExistValueBackgroundColor = getInputValue('cfg-control-existValueBackgroundColor')
    const controlNoValueBackgroundColor = getInputValue('cfg-control-noValueBackgroundColor')
    if (controlPrefix || controlPostfix || controlBorderColor || controlBorderWidth !== null ||
        controlPlaceholderColor || controlBracketColor || controlActiveBackgroundColor !== '' ||
        controlDisabledBackgroundColor !== '' || controlExistValueBackgroundColor !== '' || controlNoValueBackgroundColor !== '') {
      options.control = {}
      if (controlPrefix) options.control.prefix = controlPrefix
      if (controlPostfix) options.control.postfix = controlPostfix
      if (controlBorderColor) options.control.borderColor = controlBorderColor
      if (controlBorderWidth !== null) options.control.borderWidth = controlBorderWidth
      if (controlPlaceholderColor) options.control.placeholderColor = controlPlaceholderColor
      if (controlBracketColor) options.control.bracketColor = controlBracketColor
      options.control.activeBackgroundColor = controlActiveBackgroundColor
      options.control.disabledBackgroundColor = controlDisabledBackgroundColor
      options.control.existValueBackgroundColor = controlExistValueBackgroundColor
      options.control.noValueBackgroundColor = controlNoValueBackgroundColor
    }

    // Cursor
    const cursorColor = getInputValue('cfg-cursor-color')
    const cursorWidth = getNumberValue('cfg-cursor-width')
    const cursorDragWidth = getNumberValue('cfg-cursor-dragWidth')
    const cursorDragColor = getInputValue('cfg-cursor-dragColor')
    const cursorDragFloatImageDisabled = document.getElementById('cfg-cursor-dragFloatImageDisabled')?.checked
    if (cursorColor || cursorWidth !== null || cursorDragWidth !== null || cursorDragColor || cursorDragFloatImageDisabled !== undefined) {
      options.cursor = {}
      if (cursorColor) options.cursor.color = cursorColor
      if (cursorWidth !== null) options.cursor.width = cursorWidth
      if (cursorDragWidth !== null) options.cursor.dragWidth = cursorDragWidth
      if (cursorDragColor) options.cursor.dragColor = cursorDragColor
      if (cursorDragFloatImageDisabled !== undefined) options.cursor.dragFloatImageDisabled = cursorDragFloatImageDisabled
    }

    // Title
    const titleLevel1 = getNumberValue('cfg-title-level1')
    const titleLevel2 = getNumberValue('cfg-title-level2')
    const titleLevel3 = getNumberValue('cfg-title-level3')
    const titleLevel4 = getNumberValue('cfg-title-level4')
    const titleLevel5 = getNumberValue('cfg-title-level5')
    const titleLevel6 = getNumberValue('cfg-title-level6')
    if (titleLevel1 !== null || titleLevel2 !== null || titleLevel3 !== null ||
        titleLevel4 !== null || titleLevel5 !== null || titleLevel6 !== null) {
      options.title = {}
      if (titleLevel1 !== null) options.title.defaultFirstSize = titleLevel1
      if (titleLevel2 !== null) options.title.defaultSecondSize = titleLevel2
      if (titleLevel3 !== null) options.title.defaultThirdSize = titleLevel3
      if (titleLevel4 !== null) options.title.defaultFourthSize = titleLevel4
      if (titleLevel5 !== null) options.title.defaultFifthSize = titleLevel5
      if (titleLevel6 !== null) options.title.defaultSixthSize = titleLevel6
    }

    // Header
    const headerMaxHeight = getNumberValue('cfg-header-maxHeight')
    const headerDisabled = document.getElementById('cfg-header-disabled')?.checked
    if (headerMaxHeight !== null || headerDisabled !== undefined) {
      options.header = { maxHeightRadio: 'half', editable: true }
      if (headerMaxHeight !== null) options.header.maxHeight = headerMaxHeight
      if (headerDisabled !== undefined) options.header.disabled = headerDisabled
    }

    // Footer
    const footerMaxHeight = getNumberValue('cfg-footer-maxHeight')
    const footerDisabled = document.getElementById('cfg-footer-disabled')?.checked
    if (footerMaxHeight !== null || footerDisabled !== undefined) {
      options.footer = { maxHeightRadio: 'half', editable: true }
      if (footerMaxHeight !== null) options.footer.maxHeight = footerMaxHeight
      if (footerDisabled !== undefined) options.footer.disabled = footerDisabled
    }

    // Zone
    const zoneTipDisabled = document.getElementById('cfg-zone-tipDisabled')?.checked
    if (zoneTipDisabled !== undefined) {
      options.zone = { tipDisabled: zoneTipDisabled }
    }

    // Checkbox
    const checkboxWidth = getNumberValue('cfg-checkbox-width')
    const checkboxHeight = getNumberValue('cfg-checkbox-height')
    const checkboxGap = getNumberValue('cfg-checkbox-gap')
    const checkboxLineWidth = getNumberValue('cfg-checkbox-lineWidth')
    const checkboxFillStyle = getInputValue('cfg-checkbox-fillStyle')
    const checkboxStrokeStyle = getInputValue('cfg-checkbox-strokeStyle')
    const checkboxCheckFillStyle = getInputValue('cfg-checkbox-checkFillStyle')
    const checkboxCheckStrokeStyle = getInputValue('cfg-checkbox-checkStrokeStyle')
    const checkboxCheckMarkColor = getInputValue('cfg-checkbox-checkMarkColor')
    const checkboxVerticalAlign = document.getElementById('cfg-checkbox-verticalAlign')?.value
    if (checkboxWidth !== null || checkboxHeight !== null || checkboxGap !== null || checkboxLineWidth !== null ||
        checkboxFillStyle || checkboxStrokeStyle || checkboxCheckFillStyle || checkboxCheckStrokeStyle || checkboxCheckMarkColor || checkboxVerticalAlign) {
      options.checkbox = {}
      if (checkboxWidth !== null) options.checkbox.width = checkboxWidth
      if (checkboxHeight !== null) options.checkbox.height = checkboxHeight
      if (checkboxGap !== null) options.checkbox.gap = checkboxGap
      if (checkboxLineWidth !== null) options.checkbox.lineWidth = checkboxLineWidth
      if (checkboxFillStyle) options.checkbox.fillStyle = checkboxFillStyle
      if (checkboxStrokeStyle) options.checkbox.strokeStyle = checkboxStrokeStyle
      if (checkboxCheckFillStyle) options.checkbox.checkFillStyle = checkboxCheckFillStyle
      if (checkboxCheckStrokeStyle) options.checkbox.checkStrokeStyle = checkboxCheckStrokeStyle
      if (checkboxCheckMarkColor) options.checkbox.checkMarkColor = checkboxCheckMarkColor
      if (checkboxVerticalAlign) options.checkbox.verticalAlign = checkboxVerticalAlign
    }

    // Radio
    const radioWidth = getNumberValue('cfg-radio-width')
    const radioHeight = getNumberValue('cfg-radio-height')
    const radioGap = getNumberValue('cfg-radio-gap')
    const radioLineWidth = getNumberValue('cfg-radio-lineWidth')
    const radioFillStyle = getInputValue('cfg-radio-fillStyle')
    const radioStrokeStyle = getInputValue('cfg-radio-strokeStyle')
    const radioVerticalAlign = document.getElementById('cfg-radio-verticalAlign')?.value
    if (radioWidth !== null || radioHeight !== null || radioGap !== null || radioLineWidth !== null ||
        radioFillStyle || radioStrokeStyle || radioVerticalAlign) {
      options.radio = {}
      if (radioWidth !== null) options.radio.width = radioWidth
      if (radioHeight !== null) options.radio.height = radioHeight
      if (radioGap !== null) options.radio.gap = radioGap
      if (radioLineWidth !== null) options.radio.lineWidth = radioLineWidth
      if (radioFillStyle) options.radio.fillStyle = radioFillStyle
      if (radioStrokeStyle) options.radio.strokeStyle = radioStrokeStyle
      if (radioVerticalAlign) options.radio.verticalAlign = radioVerticalAlign
    }

    // Group
    const groupBackgroundColor = getInputValue('cfg-group-backgroundColor')
    const groupOpacity = getNumberValue('cfg-group-opacity')
    const groupActiveBackgroundColor = getInputValue('cfg-group-activeBackgroundColor')
    const groupActiveOpacity = getNumberValue('cfg-group-activeOpacity')
    const groupDisabled = document.getElementById('cfg-group-disabled')?.checked
    const groupDeletable = document.getElementById('cfg-group-deletable')?.checked
    if (groupBackgroundColor || groupOpacity !== null || groupActiveBackgroundColor || groupActiveOpacity !== null ||
        groupDisabled !== undefined || groupDeletable !== undefined) {
      options.group = {}
      if (groupBackgroundColor) options.group.backgroundColor = groupBackgroundColor
      if (groupOpacity !== null) options.group.opacity = groupOpacity
      if (groupActiveBackgroundColor) options.group.activeBackgroundColor = groupActiveBackgroundColor
      if (groupActiveOpacity !== null) options.group.activeOpacity = groupActiveOpacity
      if (groupDisabled !== undefined) options.group.disabled = groupDisabled
      if (groupDeletable !== undefined) options.group.deletable = groupDeletable
    }

    // Page Break
    const pageBreakFont = getInputValue('cfg-pageBreak-font')
    const pageBreakFontSize = getNumberValue('cfg-pageBreak-fontSize')
    if (pageBreakFont || pageBreakFontSize !== null) {
      options.pageBreak = {}
      if (pageBreakFont) options.pageBreak.font = pageBreakFont
      if (pageBreakFontSize !== null) options.pageBreak.fontSize = pageBreakFontSize
    }

    // Background
    const backgroundColor = getInputValue('cfg-background-color')
    if (backgroundColor) {
      options.background = { color: backgroundColor }
    }

    // Line Break
    const lineBreakDisabled = document.getElementById('cfg-lineBreak-disabled')?.checked
    const lineBreakColor = getInputValue('cfg-lineBreak-color')
    const lineBreakLineWidth = getNumberValue('cfg-lineBreak-lineWidth')
    if (lineBreakDisabled !== undefined || lineBreakColor || lineBreakLineWidth !== null) {
      options.lineBreak = {}
      if (lineBreakDisabled !== undefined) options.lineBreak.disabled = lineBreakDisabled
      if (lineBreakColor) options.lineBreak.color = lineBreakColor
      if (lineBreakLineWidth !== null) options.lineBreak.lineWidth = lineBreakLineWidth
    }

    // Whitespace
    const whiteSpaceDisabled = document.getElementById('cfg-whiteSpace-disabled')?.checked
    const whiteSpaceColor = getInputValue('cfg-whiteSpace-color')
    const whiteSpaceRadius = getNumberValue('cfg-whiteSpace-radius')
    if (whiteSpaceDisabled !== undefined || whiteSpaceColor || whiteSpaceRadius !== null) {
      options.whiteSpace = {}
      if (whiteSpaceDisabled !== undefined) options.whiteSpace.disabled = whiteSpaceDisabled
      if (whiteSpaceColor) options.whiteSpace.color = whiteSpaceColor
      if (whiteSpaceRadius !== null) options.whiteSpace.radius = whiteSpaceRadius
    }

    // Line Number
    const lineNumberDisabled = document.getElementById('cfg-lineNumber-disabled')?.checked
    const lineNumberSize = getNumberValue('cfg-lineNumber-size')
    const lineNumberFont = getInputValue('cfg-lineNumber-font')
    const lineNumberColor = getInputValue('cfg-lineNumber-color')
    const lineNumberRight = getNumberValue('cfg-lineNumber-right')
    const lineNumberType = document.getElementById('cfg-lineNumber-type')?.value
    if (lineNumberDisabled !== undefined || lineNumberSize !== null || lineNumberFont || lineNumberColor || lineNumberRight !== null || lineNumberType) {
      options.lineNumber = {}
      if (lineNumberDisabled !== undefined) options.lineNumber.disabled = lineNumberDisabled
      if (lineNumberSize !== null) options.lineNumber.size = lineNumberSize
      if (lineNumberFont) options.lineNumber.font = lineNumberFont
      if (lineNumberColor) options.lineNumber.color = lineNumberColor
      if (lineNumberRight !== null) options.lineNumber.right = lineNumberRight
      if (lineNumberType) options.lineNumber.type = lineNumberType
    }

    // Page Border
    const pageBorderDisabled = document.getElementById('cfg-pageBorder-disabled')?.checked
    const pageBorderColor = getInputValue('cfg-pageBorder-color')
    const pageBorderLineWidth = getNumberValue('cfg-pageBorder-lineWidth')
    if (pageBorderDisabled !== undefined || pageBorderColor || pageBorderLineWidth !== null) {
      options.pageBorder = {}
      if (pageBorderDisabled !== undefined) options.pageBorder.disabled = pageBorderDisabled
      if (pageBorderColor) options.pageBorder.color = pageBorderColor
      if (pageBorderLineWidth !== null) options.pageBorder.lineWidth = pageBorderLineWidth
    }

    // Superscript
    const badgeTop = getNumberValue('cfg-badge-top')
    const badgeLeft = getNumberValue('cfg-badge-left')
    if (badgeTop !== null || badgeLeft !== null) {
      options.badge = {}
      if (badgeTop !== null) options.badge.top = badgeTop
      if (badgeLeft !== null) options.badge.left = badgeLeft
    }

    // Graffiti
    const graffitiDefaultLineColor = getInputValue('cfg-graffiti-defaultLineColor')
    const graffitiDefaultLineWidth = getNumberValue('cfg-graffiti-defaultLineWidth')
    if (graffitiDefaultLineColor || graffitiDefaultLineWidth !== null) {
      options.graffiti = {}
      if (graffitiDefaultLineColor) options.graffiti.defaultLineColor = graffitiDefaultLineColor
      if (graffitiDefaultLineWidth !== null) options.graffiti.defaultLineWidth = graffitiDefaultLineWidth
    }

    // Label
    const labelDefaultColor = getInputValue('cfg-label-defaultColor')
    const labelDefaultBackgroundColor = getInputValue('cfg-label-defaultBackgroundColor')
    const labelDefaultBorderRadius = getNumberValue('cfg-label-defaultBorderRadius')
    if (labelDefaultColor || labelDefaultBackgroundColor || labelDefaultBorderRadius !== null) {
      options.label = {}
      if (labelDefaultColor) options.label.defaultColor = labelDefaultColor
      if (labelDefaultBackgroundColor) options.label.defaultBackgroundColor = labelDefaultBackgroundColor
      if (labelDefaultBorderRadius !== null) options.label.defaultBorderRadius = labelDefaultBorderRadius
    }

    // Image Caption
    const imgCaptionColor = getInputValue('cfg-imgCaption-color')
    const imgCaptionFont = getInputValue('cfg-imgCaption-font')
    const imgCaptionSize = getNumberValue('cfg-imgCaption-size')
    const imgCaptionTop = getNumberValue('cfg-imgCaption-top')
    if (imgCaptionColor || imgCaptionFont || imgCaptionSize !== null || imgCaptionTop !== null) {
      options.imgCaption = {}
      if (imgCaptionColor) options.imgCaption.color = imgCaptionColor
      if (imgCaptionFont) options.imgCaption.font = imgCaptionFont
      if (imgCaptionSize !== null) options.imgCaption.size = imgCaptionSize
      if (imgCaptionTop !== null) options.imgCaption.top = imgCaptionTop
    }

    // List
    const listInheritStyle = document.getElementById('cfg-list-inheritStyle')?.checked
    if (listInheritStyle !== undefined) {
      options.list = { inheritStyle: listInheritStyle }
    }

    return options
  }

  function getInputValue(id) {
    const el = document.getElementById(id)
    if (!el) return ''
    // For color input, if has transparent class, return empty string
    if (el.type === 'color' && el.classList.contains('transparent')) {
      return ''
    }
    return el.value.trim()
  }

  function getNumberValue(id) {
    const el = document.getElementById(id)
    if (!el || !el.value) return null
    const num = parseFloat(el.value)
    return isNaN(num) ? null : num
  }

  function parseMargins(str) {
    if (!str) return null
    try {
      const arr = JSON.parse(str)
      if (Array.isArray(arr) && arr.length === 4) {
        return arr
      }
    } catch (e) {}
    return null
  }

  function showConfigError(message) {
    if (dom.configError) {
      dom.configError.textContent = message
      dom.configError.style.display = 'block'
    }
  }

  function hideConfigError() {
    if (dom.configError) {
      dom.configError.style.display = 'none'
    }
  }

  // ============ Event Monitor Panel ============
  // Event configuration mapping
  const eventConfig = {
    // Content change
    contentChange: { monitor: 'monitorContent', category: 'content' },
    // Selection style change
    rangeStyleChange: { monitor: 'monitorRange', category: 'range' },
    // Page related
    visiblePageNoListChange: { monitor: 'monitorPage', category: 'page' },
    intersectionPageNoChange: { monitor: 'monitorPage', category: 'page' },
    pageSizeChange: { monitor: 'monitorPage', category: 'page' },
    pageScaleChange: { monitor: 'monitorPage', category: 'page' },
    pageModeChange: { monitor: 'monitorPage', category: 'page' },
    // Control related
    controlChange: { monitor: 'monitorControl', category: 'control' },
    controlContentChange: { monitor: 'monitorControl', category: 'control' },
    // Mouse events
    mousemove: { monitor: 'monitorMouse', category: 'mouse' },
    mouseenter: { monitor: 'monitorMouse', category: 'mouse' },
    mouseleave: { monitor: 'monitorMouse', category: 'mouse' },
    mousedown: { monitor: 'monitorMouse', category: 'mouse' },
    mouseup: { monitor: 'monitorMouse', category: 'mouse' },
    click: { monitor: 'monitorMouse', category: 'mouse' },
    // Input events
    input: { monitor: 'monitorInput', category: 'input' },
    // Other events
    saved: { monitor: 'monitorOther', category: 'other' },
    zoneChange: { monitor: 'monitorOther', category: 'other' },
    positionContextChange: { monitor: 'monitorOther', category: 'other' },
    // Image events
    imageSizeChange: { monitor: 'monitorImage', category: 'image' },
    imageMousedown: { monitor: 'monitorImage', category: 'image' },
    imageDblclick: { monitor: 'monitorImage', category: 'image' },
    // Label events
    labelMousedown: { monitor: 'monitorOther', category: 'other' }
  }

  function handleEventEmitted(payload) {
    if (!payload || !payload.event) {
      return
    }
    const config = eventConfig[payload.event]
    if (!config) {
      return
    }

    // Check if corresponding monitor switch is on
    const monitorEl = dom[config.monitor]
    if (!monitorEl || !monitorEl.checked) {
      return
    }

    const entry = {
      time: new Date().toLocaleTimeString(),
      event: payload.event,
      category: config.category,
      data: payload.data
    }

    state.eventLog.push(entry)
    if (state.eventLog.length > 100) {
      state.eventLog.shift()
    }

    updateEventLog()
  }

  function updateEventLog() {
    dom.eventLog.innerHTML = state.eventLog
      .map(
        entry => {
          const categoryClass = entry.category || 'other'
          return `
      <div class="log-item ${categoryClass}">
        <span class="log-time">${entry.time}</span>
        <span class="log-type event">${categoryClass.toUpperCase()}</span>
        <span class="log-name">${entry.event}</span>
        <span class="log-args">${truncate(JSON.stringify(entry.data), 50)}</span>
      </div>
    `
        }
      )
      .join('')

    dom.eventCount.textContent = `Events: ${state.eventLog.length}`

    // Auto-scroll to bottom
    dom.eventLog.scrollTop = dom.eventLog.scrollHeight
  }

  // ============ Utility Functions ============
  function switchTab(tabName) {
    state.currentTab = tabName

    dom.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName)
    })

    dom.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`)
    })

    refreshData()

    // Auto-refresh config when switching to config tab
    if (tabName === 'config') {
      refreshConfig()
    }
  }

  // ============ Script Panel ============
  function executeScript() {
    if (!state.connected) {
      updateScriptStatus('Not connected to editor', 'error')
      return
    }

    const script = dom.scriptInput.value.trim()
    if (!script) {
      updateScriptStatus('Please enter a script', 'error')
      return
    }

    updateScriptStatus('Running...', 'running')

    // Wrap user script to capture return value and handle errors
    const wrappedScript = `
      (function() {
        try {
          const editor = window.__CANVAS_EDITOR_INSTANCE__;
          if (!editor) {
            return { __error: 'Editor instance not found' };
          }
          const result = (function() {
            ${script}
          })();
          return { __success: true, result: result };
        } catch (err) {
          return { __error: err.message || String(err) };
        }
      })()
    `

    chrome.devtools.inspectedWindow.eval(
      wrappedScript,
      function (result, exceptionInfo) {
        if (exceptionInfo) {
          updateScriptStatus('Execution failed', 'error')
          dom.scriptOutput.textContent = formatScriptError(exceptionInfo)
          return
        }

        if (result && result.__error) {
          updateScriptStatus('Execution failed', 'error')
          dom.scriptOutput.textContent = 'Error: ' + result.__error
        } else if (result && result.__success) {
          updateScriptStatus('Success', 'success')
          dom.scriptOutput.textContent = formatScriptResult(result.result)
          addScriptToHistory(script)
        } else {
          updateScriptStatus('Success', 'success')
          dom.scriptOutput.textContent = formatScriptResult(result)
          addScriptToHistory(script)
        }
      }
    )
  }

  function clearScript() {
    dom.scriptInput.value = ''
    dom.scriptOutput.textContent = ''
    updateScriptStatus('', '')
  }

  function updateScriptStatus(message, type) {
    dom.scriptStatus.textContent = message
    dom.scriptStatus.className = 'script-status ' + type
  }

  function formatScriptResult(result) {
    if (result === undefined) {
      return 'undefined'
    }
    if (result === null) {
      return 'null'
    }
    if (typeof result === 'string') {
      return result
    }
    try {
      return JSON.stringify(result, null, 2)
    } catch (e) {
      return String(result)
    }
  }

  function formatScriptError(exceptionInfo) {
    if (exceptionInfo.isException) {
      return 'Exception: ' + (exceptionInfo.value || exceptionInfo.description || 'Unknown error')
    }
    if (exceptionInfo.isError) {
      return 'Error: ' + (exceptionInfo.description || 'Unknown error')
    }
    return 'Error: ' + JSON.stringify(exceptionInfo, null, 2)
  }

  // ============ Script History ============
  const SCRIPT_HISTORY_KEY = 'canvas-editor-script-history'
  const MAX_HISTORY_ITEMS = 20

  function loadScriptHistory() {
    try {
      const stored = localStorage.getItem(SCRIPT_HISTORY_KEY)
      if (stored) {
        state.scriptHistory = JSON.parse(stored)
        updateHistoryList()
      }
    } catch (e) {
      console.error('Failed to load script history:', e)
      state.scriptHistory = []
    }
  }

  function saveScriptHistory() {
    try {
      localStorage.setItem(SCRIPT_HISTORY_KEY, JSON.stringify(state.scriptHistory))
      updateHistoryList()
    } catch (e) {
      console.error('Failed to save script history:', e)
    }
  }

  function addScriptToHistory(script) {
    const trimmed = script.trim()
    if (!trimmed || trimmed === 'const editor = window.__CANVAS_EDITOR_INSTANCE__') {
      return
    }
    // Remove if already exists (to move to top)
    const index = state.scriptHistory.indexOf(trimmed)
    if (index > -1) {
      state.scriptHistory.splice(index, 1)
    }
    // Add to beginning
    state.scriptHistory.unshift(trimmed)
    // Keep only max items
    if (state.scriptHistory.length > MAX_HISTORY_ITEMS) {
      state.scriptHistory = state.scriptHistory.slice(0, MAX_HISTORY_ITEMS)
    }
    saveScriptHistory()
  }

  function updateHistoryList() {
    if (!dom.historyList) return

    dom.historyList.innerHTML = ''

    if (state.scriptHistory.length === 0) {
      dom.historyList.innerHTML = '<div class="history-empty">No history yet</div>'
      return
    }

    state.scriptHistory.forEach((script) => {
      const item = document.createElement('div')
      item.className = 'history-item'
      item.dataset.script = script

      // Check if content needs expand button
      const needsExpand = script.length > 150 || script.split('\n').length > 3

      // Preview content (first 3 lines, max 150 chars)
      const lines = script.split('\n')
      const preview = lines.slice(0, 3).join('\n')
      const previewText = preview.length > 150 ? preview.slice(0, 150) + '...' : preview

      // Content container
      const contentDiv = document.createElement('div')
      contentDiv.className = 'history-content'
      contentDiv.textContent = previewText
      item.appendChild(contentDiv)

      // Expand button if needed
      if (needsExpand) {
        const expandBtn = document.createElement('button')
        expandBtn.className = 'history-expand-btn'
        expandBtn.title = 'Expand'
        expandBtn.dataset.expanded = 'false'
        expandBtn.dataset.fullScript = script
        expandBtn.dataset.preview = previewText

        // Create SVG icon
        const createChevronIcon = (direction) => {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('class', 'icon')
          svg.setAttribute('viewBox', '0 0 24 24')
          svg.setAttribute('fill', 'none')
          svg.setAttribute('stroke', 'currentColor')
          svg.setAttribute('stroke-width', '2')
          svg.setAttribute('stroke-linecap', 'round')
          svg.setAttribute('stroke-linejoin', 'round')
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
          if (direction === 'down') {
            polyline.setAttribute('points', '6 9 12 15 18 9')
          } else {
            polyline.setAttribute('points', '18 15 12 9 6 15')
          }
          svg.appendChild(polyline)
          return svg
        }

        expandBtn.appendChild(createChevronIcon('down'))

        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          const isExpanded = expandBtn.dataset.expanded === 'true'
          if (isExpanded) {
            // Collapse
            contentDiv.textContent = expandBtn.dataset.preview
            expandBtn.innerHTML = ''
            expandBtn.appendChild(createChevronIcon('down'))
            expandBtn.title = 'Expand'
            expandBtn.dataset.expanded = 'false'
            item.classList.remove('expanded')
          } else {
            // Expand
            contentDiv.textContent = expandBtn.dataset.fullScript
            expandBtn.innerHTML = ''
            expandBtn.appendChild(createChevronIcon('up'))
            expandBtn.title = 'Collapse'
            expandBtn.dataset.expanded = 'true'
            item.classList.add('expanded')
          }
        })

        item.appendChild(expandBtn)
      }

      dom.historyList.appendChild(item)
    })
  }

  function clearScriptHistory() {
    state.scriptHistory = []
    localStorage.removeItem(SCRIPT_HISTORY_KEY)
    updateHistoryList()
  }

  function truncate(str, maxLength) {
    if (!str) return ''
    str = String(str)
    return str.length > maxLength ? str.slice(0, maxLength) + '...' : str
  }

  function escapeHtml(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Expose to devtools.js
  window.startUpdating = function () {
    // No longer auto-refresh on timer, use contentChange event to trigger refresh
  }

  // Start
  init()
})()
