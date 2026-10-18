// Generates the PWA icons (purple background, white diamond + "?") as PNGs
// without any image dependencies. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = [70, 23, 143] // #46178F
const FG = [255, 255, 255]

function png(width, height, pixelFn) {
  // RGBA rows with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y)
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a
    }
  }
  const chunks = []
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    chunks.push(len, body, crc)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  chunk('IHDR', ihdr)
  chunk('IDAT', deflateSync(raw, { level: 9 }))
  chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
  ])
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

/** Diamond (rotated square) test in normalized coords (0..1). */
function inDiamond(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx)
  const dy = Math.abs(y - cy)
  return dx + dy <= r
}

function makeIcon(size, { maskable }) {
  // Maskable icons need more safe-zone padding (content within center 80%).
  const cx = 0.5
  const cy = 0.52
  const r = maskable ? 0.24 : 0.3
  const thick = size * 0.045
  return png(size, size, (x, y) => {
    const nx = x / size
    const ny = y / size
    if (inDiamond(nx, cy, cx, cy + 0.02, r)) {
      // Punch a smaller BG diamond inside to hint the Kahoot diamond shape.
      if (inDiamond(nx, ny, cx, cy + 0.02, r * 0.62)) {
        // Draw a simple "?" glyph bar in the hole using two blobs.
        const qy = Math.abs(ny - (cy - 0.02))
        const qx = Math.abs(nx - cx)
        const bar = qx < thick && qy < r * 0.36 && ny < cy + r * 0.18
        const dot = qx < thick && qy > r * 0.42 && qy < r * 0.55
        return bar || dot ? [...FG, 255] : [...BG, 255]
      }
      return [...FG, 255]
    }
    return [...BG, 255]
  })
}

writeFileSync(join(outDir, 'icon-192.png'), makeIcon(192, { maskable: false }))
writeFileSync(join(outDir, 'icon-512.png'), makeIcon(512, { maskable: false }))
writeFileSync(join(outDir, 'icon-maskable-512.png'), makeIcon(512, { maskable: true }))
console.log('icons written to', outDir)
