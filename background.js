// Canvas Editor DevTools - Background Service Worker
// Handle communication between DevTools and Content Script

// Listen for connections from DevTools (only for maintaining connection status)
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'canvas-editor-devtools') return

  port.onDisconnect.addListener(function () {
    // ignore
  })
})

// Listen for messages from content script
chrome.runtime.onMessage.addListener(function (request, sender) {
  const tabId = sender.tab?.id

  if (!tabId) {
    return false
  }

  // Forward to DevTools page
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
