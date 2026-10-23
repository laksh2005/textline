// Dev tool: prints what Textline would capture from the window in focus.
// Usage (PowerShell): $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/probe.js 5
// then switch to the app to test within 5 seconds. Chromium apps may need a second run,
// because they build their accessibility tree only after the first request.
const uia = require('../native/uia/build/Release/uia.node')

setTimeout(
  async () => {
    const fg = uia.getForeground()
    // Same as capture.js: the focused window plus windows embedded in it.
    const nodes = []
    for (const hwnd of [fg.hwnd, ...fg.embedded]) {
      const tree = await uia.snapshot(hwnd).catch(() => ({ nodes: [] }))
      nodes.push(...tree.nodes)
    }
    const { formatTree } = await import('../src/main/format.js')
    const { url, text } = formatTree(nodes)
    console.log(
      `${fg.title}\n${fg.exe}\nURL: ${url}\n${nodes.length} elements\n\n${text.slice(0, 3000)}`
    )
    process.exit(0)
  },
  Number(process.argv[2] || 0) * 1000
)
