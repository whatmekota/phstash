// Builds dist/index.js (one self-contained ES module) and the plugin zip
// (manifest.json + index.js at the root, deflated).
//   node build.mjs [--minify] [--public]
// Without --public: phstash.zip, for loading by hand.
// --public writes release/phstash-<version>.zip and release/manifest.json,
// the files a GitHub release needs.
// manifest.json here points `main` at dist/index.js, so playhound's dev mode
// (Load from folder) runs the build straight from this folder; the zip's
// manifest points it at index.js, where the module sits in the zip.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const esbuild = await import('esbuild')
const PUBLIC = process.argv.includes('--public')

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
const zipped = `${JSON.stringify({ ...manifest, main: 'index.js' }, null, 2)}\n`

await esbuild.build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: join(here, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  minify: process.argv.includes('--minify'),
  banner: { js: `// phstash ${manifest.version}` },
  logLevel: 'warning',
})

// ─── zip (deflate, no zip64) ─────────────────────────────────────────────────
function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const time = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

mkdirSync(join(here, 'dist'), { recursive: true })
const out = zip([
  ['manifest.json', Buffer.from(zipped, 'utf8')],
  ['index.js', readFileSync(join(here, 'dist/index.js'))],
  // The store's icon, also for an install from the zip.
  ['icon.png', readFileSync(join(here, 'icon.png'))],
])
let file
if (PUBLIC) {
  mkdirSync(join(here, 'release'), { recursive: true })
  file = join('release', `phstash-${manifest.version}.zip`)
  // The icon beside it, as a release asset: the store shows it before downloading.
  writeFileSync(join(here, 'release', 'icon.png'), readFileSync(join(here, 'icon.png')))
  // The store in playhound reads this to show the plugin before downloading it.
  writeFileSync(join(here, 'release', 'manifest.json'), zipped)
}
else {
  file = 'phstash.zip'
}
writeFileSync(join(here, file), out)
console.log(`${file}: ${out.length} bytes (v${manifest.version})`)
