// Canvas Editor DevTools - Register Panel

// Create Canvas Editor Panel
chrome.devtools.panels.create(
  'Canvas Editor',
  'icon16.png',
  'panel.html',
  function (panel) {
    console.log('[Canvas Editor DevTools] Panel created')

    // 面板显示/隐藏事件
    let panelWindow = null

    panel.onShown.addListener(function (window) {
      console.log('[Canvas Editor DevTools] Panel shown')
      panelWindow = window
      // Notify panel to start updating
      if (panelWindow && panelWindow.startUpdating) {
        panelWindow.startUpdating()
      }
    })

    panel.onHidden.addListener(function () {
      console.log('[Canvas Editor DevTools] Panel hidden')
    })
  }
)

