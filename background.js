// Canvas Editor DevTools - Background Service Worker
// 处理 DevTools 和 Content Script 之间的通信

// 监听来自 DevTools 的连接（仅用于保持连接状态）
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'canvas-editor-devtools') return

  port.onDisconnect.addListener(function () {
    // ignore
  })
})

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener(function (request, sender) {
  const tabId = sender.tab?.id

  if (!tabId) {
    return false
  }

  // 转发给 DevTools 页面
  try {
    chrome.runtime.sendMessage({
      type: request.type,
      payload: request.payload,
      sourceTabId: tabId
    })
  } catch (e) {
    // ignore
  }

  return false
})
