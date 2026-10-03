// Scores the engine on the sample charts:  npx tsx tests/recognize.ts [sample...]
import { createCanvas } from '@napi-rs/canvas'
import type { TextRenderer } from '../src/engine/glyphs'
import { recognise } from '../src/engine/recognize'
import { loadSample, SAMPLES } from './load'

const SS = 4
const render: TextRenderer = (text, font, size, box) => {
  const canvas = createCanvas(box * SS, box * SS)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, box * SS, box * SS)
  ctx.fillStyle = '#fff'
  ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))))
  const m = ctx.measureText(text)
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  ctx.fillText(text, (box * SS - w) / 2 + m.actualBoundingBoxLeft, (box * SS - h) / 2 + m.actualBoundingBoxAscent)
  const px = ctx.getImageData(0, 0, box * SS, box * SS).data
  const out = new Float32Array(box * box)
  for (let y = 0; y < box * SS; y++)
    for (let x = 0; x < box * SS; x++) out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS)
  return out
}

// legends read by hand from the charts; used for scoring only
const TRUTH: Record<string, { size: [number, number]; legend?: Record<string, number> }> = {
  tree: { size: [52, 64], legend: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 } },
  dog: { size: [104, 104], legend: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 } },
  landscape: { size: [84, 84], legend: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 } },
  portrait: { size: [50, 70] },
}


// Independent colour-only experiment. OCR results are used only to share the existing
// empty-cell mask on the tree sample; colour names are never taken from Recognition.
import { CATALOGUE, CODES } from '../src/engine/glyphs'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function lab(rgb: number[]): number[] {
  const v=rgb.map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4})
  const xyz=[(v[0]*.4124564+v[1]*.3575761+v[2]*.1804375)/.95047,
    v[0]*.2126729+v[1]*.7151522+v[2]*.0721750,
    (v[0]*.0193339+v[1]*.1191920+v[2]*.9503041)/1.08883]
  const f=xyz.map(t=>t>(6/29)**3?Math.cbrt(t):t/(3*(6/29)**2)+4/29)
  return [116*f[1]-16,500*(f[0]-f[1]),200*(f[1]-f[2])]
}
const palette=CODES.map(code=>{const c=CATALOGUE[code];return [c.r,c.g,c.b]})
const distance=(a:number[],b:number[],metric:string)=>a.reduce((s,v,i)=>s+(metric==='rgb-l1'?Math.abs(v-b[i]):(v-b[i])**2),0)
const out=resolve('../research/out/colour-baseline'); mkdirSync(out,{recursive:true})
// Manual code-to-swatch annotation for this experiment only. Counts are not used.
// Screenshot sampling is not an automatic legend-reading implementation.
const swatches:Record<string,{codes:string[];x:number[];y:number;w:number;h:number}[]>={
 tree:[{codes:'B11 B15 B17 B22 B23 B29 B32 F11 G17 H2 H7 H16 H17'.split(' '),x:Array.from({length:13},(_,i)=>38+i*97),y:1835,w:30,h:17}],
 dog:[{codes:'A1 H2 H7 F21 G12 A11 E4 B30 E18 B17 C17 C26 B13 F13 M2 M3 F23 F19 F14'.split(' '),x:Array.from({length:19},(_,i)=>12+i*44.15),y:1246,w:13,h:10}],
 landscape:[{codes:'A3 A6 A7 A8 A15 A22 A26 B1 B7 B8 B9 B11 B13 B15 B18 B19 B21 B26 B29 B32 C3 C19 C24 C27 F8 F10 F11 F13 F19 G7 G8 G13 G17 G19 H12'.split(' '),x:Array.from({length:35},(_,i)=>16+i*20.87),y:1096,w:14,h:17}],
 portrait:[
 {codes:'A1 A12 A23 B26 C29 D3 D7 D10 D13 D19 D21 E1 E3 E7 E8 E10 E11 E15 E16 E17 E19 E20 E21 E23 E24 F6 F7 F9 F10 F11'.split(' '),x:Array.from({length:30},(_,i)=>52+i*30.5),y:1355,w:22,h:21},
 {codes:'F16 F19 F20 F21 F24 G4 G7 G8 G13 G14 G16 G17 G20 H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13 ?1 ?2 ?3 H19'.split(' '),x:Array.from({length:30},(_,i)=>52+i*30.5),y:1412,w:22,h:21},
 {codes:'H20 H22 H23 M4 M6 M7 M8 M9 M10 M11 M12 M13 M14'.split(' '),x:Array.from({length:13},(_,i)=>52+i*30.5),y:1468,w:22,h:21}]
}
function sampleSwatches(img:ReturnType<typeof loadSample>,key:string) {
 const refs=new Map<string,number[]>()
 for(const row of swatches[key]) row.codes.forEach((code,k)=>{
   // The portrait watermark covers these swatches: don't silently treat white ink as bead colour.
   if(code.startsWith('?'))return
   const pixels:number[][]=[]
   for(let y=Math.round(row.y-row.h/2);y<row.y+row.h/2;y++)for(let x=Math.round(row.x[k]-row.w/2);x<row.x[k]+row.w/2;x++){
     const i=(y*img.width+x)*4;pixels.push(Array.from(img.data.slice(i,i+3)))
   }
   let best:number[]=[];let count=0
   for(const c of pixels){const near=pixels.filter(p=>distance(c,p,'rgb-l1')<24);if(near.length>count){count=near.length;best=[0,1,2].map(ch=>near.reduce((a,p)=>a+p[ch],0)/near.length)}}
   refs.set(code,best)
 })
 return refs
}
const reports:unknown[]=[]
const requested=process.argv.slice(2)
for(const key of (Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]).filter(k=>!requested.length||requested.includes(k))) {
  const img=loadSample(key),rec=recognise(img,render), n=rec.assign.length, legend=TRUTH[key].legend
  const refs=sampleSwatches(img,key)
  writeFileSync(resolve(out,key+'-sampled-legend.json'),JSON.stringify(Object.fromEntries(refs),null,2))
  const active=Array.from(rec.assign,g=>g>=0)
  const results:unknown[]=[]
  let exact=0
  for(let i=0;i<n;i++)if(active[i]&&palette.some(c=>c.every((v,ch)=>v===Math.round(rec.cells.fill[i*3+ch]))))exact++
  for(const source of ['all','legend-candidates','legend-swatches']) {
    if(source==='legend-candidates'&&!legend)continue
    const candidates=CODES.map((_,i)=>i).filter(i=>source==='all'||(source==='legend-candidates'?CODES[i] in legend!:refs.has(CODES[i])))
    const refPalette=source==='legend-swatches'?CODES.map(c=>refs.get(c)??[0,0,0]):palette
    const refLabs=refPalette.map(lab)
    for(const metric of ['rgb-l1','rgb-l2','lab']) {
      const counts:Record<string,number>={}, cells:string[]=[], margins:number[]=[]
      for(let i=0;i<n;i++) {
        if(!active[i]){cells.push('');continue}
        const rgb=Array.from(rec.cells.fill.subarray(i*3,i*3+3)), q=metric==='lab'?lab(rgb):rgb
        const ranked=candidates.map(k=>({k,d:distance(q,metric==='lab'?refLabs[k]:refPalette[k],metric)})).sort((a,b)=>a.d-b.d)
        const code=CODES[ranked[0].k];cells.push(code);counts[code]=(counts[code]??0)+1
        margins.push(Math.sqrt(ranked[1].d)-Math.sqrt(ranked[0].d))
      }
      const total=legend?Object.values(legend).reduce((a,b)=>a+b,0):null
      const off=legend?Array.from(new Set([...Object.keys(legend),...Object.keys(counts)])).reduce((s,c)=>s+Math.abs((legend[c]??0)-(counts[c]??0)),0):null
      const name=source+'-'+metric
      const row={method:name,colours:Object.keys(counts).length,beads:cells.filter(Boolean).length,countAgreement:total&&off!==null?100*(1-off/2/total):null,counts}
      results.push(row);console.log(key,name,JSON.stringify({...row,counts:undefined}))
      const canvas=createCanvas(rec.cells.cols*8,rec.cells.rows*8),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)
      cells.forEach((c,i)=>{if(!c)return;const p=CATALOGUE[c];ctx.fillStyle=`rgb(${p.r},${p.g},${p.b})`;ctx.fillRect(i%rec.cells.cols*8,Math.floor(i/rec.cells.cols)*8,8,8)})
      writeFileSync(resolve(out,key+'-'+name+'.png'),canvas.toBuffer('image/png'))
      writeFileSync(resolve(out,key+'-'+name+'-cells.json'),JSON.stringify({cols:rec.cells.cols,rows:rec.cells.rows,grid:rec.grid,r0:rec.cells.r0,c0:rec.cells.c0,cells}))
    }
  }
  const row={sample:key,cols:rec.cells.cols,rows:rec.cells.rows,exactRoundedHex:exact,activeCells:active.filter(Boolean).length,results};reports.push(row)
  console.log(key,'exact rounded HEX',exact,'/',row.activeCells)
}
writeFileSync(resolve(out,'results.json'),JSON.stringify({notes:['Count agreement is an upper bound on cell accuracy, not cell accuracy.','Legend-candidate runs use manually transcribed code sets as an oracle, never counts.','Tree shares the existing recogniser blank mask; other samples have all cells active.','Legend-swatches use manually annotated code labels and positions. Three portrait swatches are excluded due to watermark; their labels were not confirmed. Portrait has no verified count ground truth.'],reports},null,2))

if(!requested.length||requested.includes('portrait')) {
  const audit=JSON.parse(readFileSync(new URL('./colour-audit.json',import.meta.url),'utf8')) as {labels:{tile:number;index:number;code:string}[]}
  const results=[]
  for(const source of ['all','legend-swatches'])for(const metric of ['rgb-l1','rgb-l2','lab']) {
    const data=JSON.parse(readFileSync(resolve(out,`portrait-${source}-${metric}-cells.json`),'utf8')) as {cells:string[]}
    const wrong=audit.labels.filter(x=>data.cells[x.index]!==x.code).map(x=>({...x,predicted:data.cells[x.index]}))
    results.push({method:source+'-'+metric,correct:audit.labels.length-wrong.length,total:audit.labels.length,wrong})
  }
  writeFileSync(resolve(out,'portrait-spot-audit.json'),JSON.stringify({...audit,results},null,2))
  console.log('Portrait readable-cell spot check',results.map(({method,correct,total})=>({method,correct,total})))
}
