// Loads the compiled C++ addon (native/uia). If it hasn't been built yet the app
// still opens and shows the error instead of crashing.
import { app } from 'electron'
import { join } from 'path'
import { createRequire } from 'module'

const require = createRequire(__filename)

export function loadUia() {
  // Packaged builds keep .node files outside the asar archive.
  const path = join(app.getAppPath(), 'native/uia/build/Release/uia.node').replace(
    'app.asar',
    'app.asar.unpacked'
  )
  try {
    return { uia: require(path), error: null }
  } catch (e) {
    return {
      uia: null,
      error: `Capture engine not built (${e.message}). Run: npm run build:native`
    }
  }
}
