// Generates every app icon from resources/logo.svg.
// Usage: node scripts/make-icons.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'

const svg = readFileSync('resources/logo.svg')
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()

writeFileSync('resources/icon.png', await png(512)) // window + tray (main process)
writeFileSync('build/icon.png', await png(512)) // electron-builder
writeFileSync('src/renderer/src/assets/logo.png', await png(128)) // in-app header
writeFileSync(
  'build/icon.ico',
  await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(png)))
)
console.log('icons written')
