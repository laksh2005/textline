// Dev tool: prints what Textline would capture from the window in focus.
// Usage (PowerShell): $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/probe.js 5   (switch to the app to test)
const uia = require('../native/uia/build/Release/uia.node')
const delay = Number(process.argv[2] || 0) * 1000

setTimeout(async () => {
  const fg = uia.getForeground()
  console.log('FOREGROUND', fg)
  const t = Date.now()
  let tree = await uia.snapshot(fg.hwnd)
  if (tree.nodes.length < 50) {
    await new Promise((r) => setTimeout(r, 800))
    tree = await uia.snapshot(fg.hwnd)
  }
  console.log(`NODES ${tree.nodes.length} in ${Date.now() - t}ms`)
  const { formatTree } = await import('../src/main/format.js')
  const { url, lines, text } = formatTree(tree.nodes)
  console.log('URL', url, '| LINES', lines.length)
  console.log(text.slice(0, 3000))
  process.exit(0)
}, delay)
