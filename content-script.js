// Canvas Editor DevTools - Content Script
// 注入页面，桥接 DevTools 和 Editor 实例

(function () {
  'use strict'

  // 注入脚本到页面
  function injectScript(src) {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL(src)
    script.onload = function () {
      this.remove()
    }
    script.onerror = function () {
      this.remove()
    }
    const target = document.head || document.documentElement
    if (target) {
      target.appendChild(script)
    }
  }

  // 监听来自页面的消息，转发给 DevTools
  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    if (!event.data || event.data.source !== 'canvas-editor-devtools-page')
      return

    // 检查扩展上下文是否有效
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      return
    }

    try {
      // 转发给 background - 直接转发 type 和 payload
      chrome.runtime.sendMessage({
        type: event.data.type,
        payload: event.data.payload
      })
    } catch (e) {
      // ignore
    }
  })

  // 在 DOM 准备好后注入脚本
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      injectScript('injected-script.js')
    })
  } else {
    // DOM 已经准备好
    injectScript('injected-script.js')
  }
})()
