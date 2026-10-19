/**
 * Converts the brand's source photography in the repo-root `assests/` folder to
 * WebP and resizes it to sensible maximum widths.
 *
 * Why: the originals were 2.2–3.0 MB PNGs. They are the hero backgrounds and
 * the two story images, so they dominate the storefront's transfer size. WebP
 * at the same on-screen resolution is roughly 10× smaller (e.g. Kitchen.png
 * 2.95 MB → ~320 KB) with no visible difference.
 *
 * The storefront discovers hero images from `assests/desktop` and
 * `assests/mobile` by filename stem (see src/config/heroSlides.ts) and imports
 * the two `assests/body` images by path, so the output keeps the same filename
 * stem and only the extension changes — no code needs to know about the format
 * except the two explicit `body` imports.
 *
 * Run with `npm run images` after adding new photography, then commit.
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ASSETS_ROOT = fileURLToPath(new URL('../../assests', import.meta.url))

const TARGETS = [
  { dir: 'desktop', width: 1920 },
  { dir: 'mobile', width: 900 },
  { dir: 'body', width: 1600 },
]

const RASTER = new Set(['.png', '.jpg', '.jpeg'])

async function convertDirectory(dir, width) {
  const full = join(ASSETS_ROOT, dir)
  let entries
  try {
    entries = await readdir(full)
  } catch {
    return
  }

  for (const entry of entries) {
    const extension = extname(entry).toLowerCase()
    if (!RASTER.has(extension)) continue

    const source = join(full, entry)
    const output = join(full, `${basename(entry, extname(entry))}.webp`)

    const before = (await stat(source)).size
    await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 })
      .toFile(output)
    const after = (await stat(output)).size

    await unlink(source)

    const saved = Math.round((1 - after / before) * 100)
    console.log(
      `${dir}/${entry} -> ${basename(output)}  ` +
        `${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (-${saved}%)`,
    )
  }
}

for (const { dir, width } of TARGETS) {
  await convertDirectory(dir, width)
}
