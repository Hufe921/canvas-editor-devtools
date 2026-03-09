// Canvas Editor DevTools - Injected Script
// Directly inject into page, interact with Editor instance

(function () {
  'use strict'

  // Safely serialize data, remove non-cloneable objects (Promise, functions, DOM elements, etc.)
  function safeSerialize(obj, maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth) return '[Max Depth]'
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'function') return '[Function]'
    if (obj instanceof Promise) return '[Promise]'
    if (obj instanceof HTMLElement) return '[HTMLElement]'
    if (obj instanceof Node) return '[Node]'
    if (obj instanceof Window) return '[Window]'
    if (obj instanceof Document) return '[Document]'

    // Process array
    if (Array.isArray(obj)) {
      return obj.map(item => safeSerialize(item, maxDepth, currentDepth + 1))
    }

    // Process date
    if (obj instanceof Date) return obj.toISOString()

    // 处理正则
    if (obj instanceof RegExp) return obj.toString()

    // 处理普通对象
    if (typeof obj === 'object') {
      const result = {}
      try {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // Skip private properties starting with _
            if (key.startsWith('_')) continue
            try {
              const value = obj[key]
              result[key] = safeSerialize(value, maxDepth, currentDepth + 1)
            } catch (e) {
              result[key] = '[Error: ' + e.message + ']'
            }
          }
        }
      } catch (e) {
        return '[Object Error]'
      }
      return result
    }

    return obj
  }

  // Wrap command methods to track calls
  function wrapCommands() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor || editor.__devtools_wrapped__) {
      return
    }

    const command = editor.command
    const originalMethods = {}

    // Record all execute* and get* methods
    Object.keys(command).forEach(key => {
      if (typeof command[key] !== 'function') return
      if (!key.startsWith('execute') && !key.startsWith('get')) return

      originalMethods[key] = command[key]

      command[key] = function (...args) {
        const startTime = performance.now()
        const type = key.startsWith('execute') ? 'command' : 'query'

        // Safely serialize arguments
        const safeArgs = args.map(arg => safeSerialize(arg, 2))

        try {
          const result = originalMethods[key].apply(command, args)
          const duration = Math.round(performance.now() - startTime)

          // Send command execution info
          const sendCommandInfo = (res, dur, isAsync) => {
            window.postMessage(
              {
                source: 'canvas-editor-devtools-page',
                type: 'COMMAND_EXECUTED',
                payload: {
                  type: type,
                  name: key,
                  args: safeArgs,
                  duration: dur,
                  result: type === 'query' ? safeSerialize(res, 3) : undefined,
                  isAsync: isAsync,
                  timestamp: Date.now()
                }
              },
              '*'
            )
          }

          // Handle Promise result
          if (result instanceof Promise) {
            result.then(
              resolvedValue => {
                sendCommandInfo(
                  resolvedValue,
                  Math.round(performance.now() - startTime),
                  true
                )
              },
              rejectedError => {
                window.postMessage(
                  {
                    source: 'canvas-editor-devtools-page',
                    type: 'COMMAND_ERROR',
                    payload: {
                      name: key,
                      error: rejectedError?.message || 'Promise rejected',
                      isAsync: true,
                      timestamp: Date.now()
                    }
                  },
                  '*'
                )
              }
            )
          } else {
            sendCommandInfo(result, duration, false)
          }

          return result
        } catch (error) {
          window.postMessage(
            {
              source: 'canvas-editor-devtools-page',
              type: 'COMMAND_ERROR',
              payload: {
                name: key,
                error: error.message,
                timestamp: Date.now()
              }
            },
            '*'
          )
          throw error
        }
      }
    })

    // Mark as wrapped
    editor.__devtools_wrapped__ = true
  }

  // Store event handler references for later removal
  const eventHandlers = new Map()

  // Listen for events
  function setupEventListeners() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor || !editor.eventBus || typeof editor.eventBus.on !== 'function') {
      return false
    }

    // If already set, remove old listener first
    if (eventHandlers.size > 0) {
      removeAllEventListeners()
    }

    // Reference eventbus.md documentation to define all supported events
    const eventDefinitions = [
      'contentChange',
      'rangeStyleChange',
      'visiblePageNoListChange',
      'intersectionPageNoChange',
      'pageSizeChange',
      'pageScaleChange',
      'controlChange',
      'controlContentChange',
      'pageModeChange',
      'saved',
      'zoneChange',
      'positionContextChange',
      'imageSizeChange',
      'imageMousedown',
      'imageDblclick',
      'labelMousedown',
      // Mouse events
      'mousemove',
      'mouseenter',
      'mouseleave',
      'mousedown',
      'mouseup',
      'click',
      'input'
    ]

    eventDefinitions.forEach(eventName => {

      const handler = data => {
        window.postMessage(
          {
            source: 'canvas-editor-devtools-page',
            type: 'EVENT_EMITTED',
            payload: {
              event: eventName,
              data: safeSerialize(data),
              timestamp: Date.now()
            }
          },
          '*'
        )

        // Trigger data update on contentChange
        if (eventName === 'contentChange') {
          window.postMessage(
            {
              source: 'canvas-editor-devtools-page',
              type: 'NEED_REFRESH_DATA'
            },
            '*'
          )
        }
      }

      // Store handler reference
      eventHandlers.set(eventName, handler)

      // Register event listener
      try {
        editor.eventBus.on(eventName, handler)
      } catch (e) {
        // ignore
      }
    })

    return true
  }

  // Remove all event listeners
  function removeAllEventListeners() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor || !editor.eventBus || typeof editor.eventBus.off !== 'function') {
      eventHandlers.clear()
      return
    }

    eventHandlers.forEach((handler, eventName) => {
      try {
        editor.eventBus.off(eventName, handler)
      } catch (e) {
        // Ignore removal error
      }
    })

    eventHandlers.clear()
  }

  // Get editor data - use correct API
  function getEditorData() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor) return null

    const command = editor.command

    try {
      // Use getValue to get complete document data
      const value = command.getValue ? command.getValue() : null
      const options = command.getOptions ? command.getOptions() : null
      const range = command.getRange ? command.getRange() : null
      const rangeContext = command.getRangeContext
        ? command.getRangeContext()
        : null

      return {
        version: editor.version,
        options: options,
        range: range,
        rangeContext: rangeContext,
        // Document data
        data: value
          ? {
              header: value.data?.header || [],
              main: value.data?.main || [],
              footer: value.data?.footer || []
            }
          : { header: [], main: [], footer: [] }
      }
    } catch (e) {
      return null
    }
  }

  // Listen for messages from content script
  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    if (!event.data || event.data.source !== 'canvas-editor-devtools-content')
      return

    const payload = event.data.payload

    switch (payload?.action) {
      case 'GET_DATA': {
        const rawData = getEditorData()
        const safeData = safeSerialize(rawData, 5)
        window.postMessage(
          {
            source: 'canvas-editor-devtools-page',
            type: 'EDITOR_DATA',
            payload: safeData
          },
          '*'
        )
        break
      }

      case 'EXECUTE_COMMAND': {
        const editor = window.__CANVAS_EDITOR_INSTANCE__
        if (editor && payload.command) {
          editor.command[payload.command](...payload.args)
        }
        break
      }
    }
  })

  // Initialize
  function init() {
    // Check immediately once
    if (window.__CANVAS_EDITOR_INSTANCE__) {
      wrapCommands()
      setupEventListeners()
      return
    }

    // Wait for Editor instance
    let attempts = 0
    const maxAttempts = 120 // Wait at most 60 seconds
    const checkInterval = setInterval(() => {
      attempts++
      if (window.__CANVAS_EDITOR_INSTANCE__) {
        clearInterval(checkInterval)
        wrapCommands()
        const success = setupEventListeners()
        if (!success) {
          // eventBus may not exist yet, continue trying
          const eventBusInterval = setInterval(() => {
            const eventBusSuccess = setupEventListeners()
            if (eventBusSuccess) {
              clearInterval(eventBusInterval)
            }
          }, 500)
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval)
      }
    }, 500)
  }

  // Clean up when page unloads
  window.addEventListener('beforeunload', () => {
    removeAllEventListeners()
  })

  // Start initialization
  init()
})()
