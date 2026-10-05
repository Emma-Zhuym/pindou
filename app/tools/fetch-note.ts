// Downloads every image of a Xiaohongshu note (full size), for local test charts.
// Run from app/:  npx tsx tools/fetch-note.ts <share link> <folder> <name>
// Images go to <folder>/<name>-1.jpg, -2.jpg …; they are other people's work: keep them local.
import { mkdirSync, writeFileSync } from 'node:fs'
import { readNote } from '../relay/xhs.ts'

const [link, folder, name] = process.argv.slice(2)
if (!link || !folder || !name) {
  console.error('usage: npx tsx tools/fetch-note.ts <share link> <folder> <name>')
  process.exit(1)
}
const note = await readNote(link)
mkdirSync(folder, { recursive: true })
console.log(note.title, `${note.images.length} images`)
for (const [k, im] of note.images.entries()) {
  const buf = Buffer.from(await (await fetch(im.url)).arrayBuffer())
  const file = `${folder}/${name}-${k + 1}.jpg`
  writeFileSync(file, buf)
  console.log(file, `${im.width}×${im.height}`, buf.length)
}
