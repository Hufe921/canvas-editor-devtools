// Canvas Editor DevTools - Injected Script
// 直接注入到页面，与 Editor 实例交互

(function () {
  'use strict'

  // 安全地序列化数据，移除不可克隆的对象（Promise、函数、DOM 元素等）
  function safeSerialize(obj, maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth) return '[Max Depth]'
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'function') return '[Function]'
    if (obj instanceof Promise) return '[Promise]'
    if (obj instanceof HTMLElement) return '[HTMLElement]'
    if (obj instanceof Node) return '[Node]'
    if (obj instanceof Window) return '[Window]'
    if (obj instanceof Document) return '[Document]'

    // 处理数组
    if (Array.isArray(obj)) {
      return obj.map(item => safeSerialize(item, maxDepth, currentDepth + 1))
    }

    // 处理日期
    if (obj instanceof Date) return obj.toISOString()

    // 处理正则
    if (obj instanceof RegExp) return obj.toString()

    // 处理普通对象
    if (typeof obj === 'object') {
      const result = {}
      try {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // 跳过以 _ 开头的私有属性
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

  // 包装命令方法以追踪调用
  function wrapCommands() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor || editor.__devtools_wrapped__) {
      return
    }

    const command = editor.command
    const originalMethods = {}

    // 记录所有 execute* 和 get* 方法
    Object.keys(command).forEach(key => {
      if (typeof command[key] !== 'function') return
      if (!key.startsWith('execute') && !key.startsWith('get')) return

      originalMethods[key] = command[key]

      command[key] = function (...args) {
        const startTime = performance.now()
        const type = key.startsWith('execute') ? 'command' : 'query'

        // 安全序列化参数
        const safeArgs = args.map(arg => safeSerialize(arg, 2))

        try {
          const result = originalMethods[key].apply(command, args)
          const duration = Math.round(performance.now() - startTime)

          // 发送命令执行信息
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

          // 处理 Promise 结果
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

    // 标记已包装
    editor.__devtools_wrapped__ = true
  }

  // 存储事件处理函数引用，用于后续移除监听
  const eventHandlers = new Map()

  // 监听事件
  function setupEventListeners() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor || !editor.eventBus || typeof editor.eventBus.on !== 'function') {
      return false
    }

    // 如果已经设置过，先移除旧的监听
    if (eventHandlers.size > 0) {
      removeAllEventListeners()
    }

    // 参考 eventbus.md 文档定义所有支持的事件
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
      // 鼠标事件
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

        // contentChange 时触发数据更新
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

      // 存储处理函数引用
      eventHandlers.set(eventName, handler)

      // 注册事件监听
      try {
        editor.eventBus.on(eventName, handler)
      } catch (e) {
        // ignore
      }
    })

    return true
  }

  // 移除所有事件监听
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
        // 忽略移除错误
      }
    })

    eventHandlers.clear()
  }

  // 获取编辑器数据 - 使用正确的 API
  function getEditorData() {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    if (!editor) return null

    const command = editor.command

    try {
      // 使用 getValue 获取完整文档数据
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
        // 文档数据
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

  // 监听来自 content script 的消息
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

  // 初始化
  function init() {
    // 立即检查一次
    if (window.__CANVAS_EDITOR_INSTANCE__) {
      wrapCommands()
      setupEventListeners()
      return
    }

    // 等待 Editor 实例
    let attempts = 0
    const maxAttempts = 120 // 最多等待60秒
    const checkInterval = setInterval(() => {
      attempts++
      if (window.__CANVAS_EDITOR_INSTANCE__) {
        clearInterval(checkInterval)
        wrapCommands()
        const success = setupEventListeners()
        if (!success) {
          // eventBus 可能还不存在，继续尝试
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

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    removeAllEventListeners()
  })

  // 启动初始化
  init()
})()
