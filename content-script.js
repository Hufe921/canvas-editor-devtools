// Canvas Editor DevTools - Content Script
// Inject into page, bridge between DevTools and Editor instance

(function () {
  'use strict'

  // Inject script into page
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

  // Listen for messages from page, forward to DevTools
  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    if (!event.data || event.data.source !== 'canvas-editor-devtools-page')
      return

    // Check if extension context is valid
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      return
    }

    try {
      // Forward to background - directly forward type and payload
      chrome.runtime.sendMessage({
        type: event.data.type,
        payload: event.data.payload
      })
    } catch (e) {
      // ignore
    }
  })

  // Inject script after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      injectScript('injected-script.js')
    })
  } else {
    // DOM is already ready
    injectScript('injected-script.js')
  }
})()
