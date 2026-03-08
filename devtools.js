// Canvas Editor DevTools - 注册面板

// 创建 Canvas Editor 面板
chrome.devtools.panels.create(
  'Canvas Editor',
  'icon16.png',
  'panel.html',
  function (panel) {
    console.log('[Canvas Editor DevTools] 面板已创建')

    // 面板显示/隐藏事件
    let panelWindow = null

    panel.onShown.addListener(function (window) {
      console.log('[Canvas Editor DevTools] 面板已显示')
      panelWindow = window
      // 通知面板开始更新
      if (panelWindow && panelWindow.startUpdating) {
        panelWindow.startUpdating()
      }
    })

    panel.onHidden.addListener(function () {
      console.log('[Canvas Editor DevTools] 面板已隐藏')
    })
  }
)

