// automatic legend localisation and fill sampling on four original/compressed pairs.
// Manual centres and codes are evaluation-only: the detector never receives them.
// Cell scoring uses oracle names, so these results are NOT end-to-end recognition accuracy.
// Run from app/: node --import tsx tests/auto-swatches.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import jpeg from 'jpeg-js';
import type { Raster } from '../src/engine/grid';
import type { TextRenderer } from '../src/engine/glyphs';
import { recognise, type Recognition } from '../src/engine/recognize';
const SS = 4;
const render: TextRenderer = (text, font, size, box) => {
    const canvas = createCanvas(box * SS, box * SS);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, box * SS, box * SS);
    ctx.fillStyle = '#fff';
    ctx.font = font.replace('SIZE', String(Math.max(4, Math.round(size * SS))));
    const m = ctx.measureText(text);
    ctx.fillText(text, (box * SS - m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 + m.actualBoundingBoxLeft, (box * SS - m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 + m.actualBoundingBoxAscent);
    const px = ctx.getImageData(0, 0, box * SS, box * SS).data;
    const out = new Float32Array(box * box);
    for (let y = 0; y < box * SS; y++)
        for (let x = 0; x < box * SS; x++)
            out[Math.floor(y / SS) * box + Math.floor(x / SS)] += px[(y * box * SS + x) * 4] / (255 * SS * SS);
    return out;
};
const load = (rel: string): Raster => {
    const img = jpeg.decode(readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url))), { useTArray: true, maxMemoryUsageInMB: 2048 });
    return { width: img.width, height: img.height, data: img.data };
};
// legends read by hand (same as tests/recognize.ts); scoring only
const LEGEND: Record<string, Record<string, number> | undefined> = {
    tree: { B23: 637, B17: 362, B11: 214, H7: 210, B32: 66, B15: 59, B29: 43, H16: 16, G17: 13, H2: 5, B22: 3, F11: 3, H17: 1 },
    dog: { A1: 3150, H2: 1599, H7: 1548, F21: 1258, G12: 738, A11: 634, E4: 466, B30: 345, E18: 334, B17: 178, C17: 155, C26: 116, B13: 96, F13: 64, M2: 36, M3: 33, F23: 31, F19: 19, F14: 16 },
    landscape: { A3: 118, A6: 176, A7: 287, A8: 320, A15: 757, A22: 24, A26: 48, B1: 267, B7: 80, B8: 557, B9: 447, B11: 143, B13: 100, B15: 55, B18: 78, B19: 125, B21: 60, B26: 171, B29: 151, B32: 499, C3: 190, C19: 77, C24: 731, C27: 76, F8: 138, F10: 94, F11: 132, F13: 328, F19: 29, G7: 206, G8: 135, G13: 35, G17: 22, G19: 265, H12: 135 },
    portrait: undefined,
};
// Hand-placed legend swatches, in samples/ pixel coordinates (copied from colour-baseline.ts)
type Row = {
    codes: string[];
    x: number[];
    y: number;
    w: number;
    h: number;
};
const seq = (n: number, a: number, d: number) => Array.from({ length: n }, (_, i) => a + i * d);
const SWATCHES: Record<string, Row[]> = {
    tree: [{ codes: 'B11 B15 B17 B22 B23 B29 B32 F11 G17 H2 H7 H16 H17'.split(' '), x: seq(13, 38, 97), y: 1835, w: 30, h: 17 }],
    dog: [{ codes: 'A1 H2 H7 F21 G12 A11 E4 B30 E18 B17 C17 C26 B13 F13 M2 M3 F23 F19 F14'.split(' '), x: seq(19, 12, 44.15), y: 1246, w: 13, h: 10 }],
    landscape: [{ codes: 'A3 A6 A7 A8 A15 A22 A26 B1 B7 B8 B9 B11 B13 B15 B18 B19 B21 B26 B29 B32 C3 C19 C24 C27 F8 F10 F11 F13 F19 G7 G8 G13 G17 G19 H12'.split(' '), x: seq(35, 16, 20.87), y: 1096, w: 14, h: 17 }],
    portrait: [
        { codes: 'A1 A12 A23 B26 C29 D3 D7 D10 D13 D19 D21 E1 E3 E7 E8 E10 E11 E15 E16 E17 E19 E20 E21 E23 E24 F6 F7 F9 F10 F11'.split(' '), x: seq(30, 52, 30.5), y: 1355, w: 22, h: 21 },
        { codes: 'F16 F19 F20 F21 F24 G4 G7 G8 G13 G14 G16 G17 G20 H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13 ?1 ?2 ?3 H19'.split(' '), x: seq(30, 52, 30.5), y: 1412, w: 22, h: 21 },
        { codes: 'H20 H22 H23 M4 M6 M7 M8 M9 M10 M11 M12 M13 M14'.split(' '), x: seq(13, 52, 30.5), y: 1468, w: 22, h: 21 },
    ],
};
const SAMPLE_WIDTH: Record<string, number> = { tree: 1280, dog: 1149, landscape: 1049, portrait: 962 };
function swatchCells(rec: Recognition, refs: Map<string, number[]>): string[] {
    const entries = [...refs];
    return Array.from(rec.assign, (g, i) => {
        if (g < 0)
            return ''; // tree: share the engine's blank mask, as in colour-baseline.ts
        const f = rec.cells.fill.subarray(i * 3, i * 3 + 3);
        let best = '';
        let bd = Infinity;
        for (const [code, c] of entries) {
            const d = Math.abs(f[0] - c[0]) + Math.abs(f[1] - c[1]) + Math.abs(f[2] - c[2]);
            if (d < bd) {
                bd = d;
                best = code;
            }
        }
        return best;
    });
}
const agreement = (counts: Map<string, number>, legend: Record<string, number>) => {
    let off = 0;
    for (const c of new Set([...Object.keys(legend), ...counts.keys()]))
        off += Math.abs((legend[c] ?? 0) - (counts.get(c) ?? 0));
    const total = Object.values(legend).reduce((a, b) => a + b, 0);
    return 100 * (1 - off / 2 / total);
};
const tally = (cells: string[]) => {
    const m = new Map<string, number>();
    for (const c of cells)
        if (c)
            m.set(c, (m.get(c) ?? 0) + 1);
    return m;
};
const audit = JSON.parse(readFileSync(new URL('./colour-audit.json', import.meta.url), 'utf8')) as {
    labels: {
        index: number;
        code: string;
    }[];
};
const PAIRS: [
    string,
    string,
    string
][] = [
    ['tree', 'samples/tree-52x64.jpg', 'samples/originals/tree-52x64.jpg'],
    ['dog', 'samples/dog-104x104.jpg', 'samples/originals/dog-104x104.jpg'],
    ['landscape', 'samples/landscape-84x84.jpg', 'samples/originals/landscape-84x84.jpg'],
    ['portrait', 'samples/portrait-50x70.jpg', 'samples/originals/portrait-50x70.jpg'],
];
// annotations used only AFTER detection, for localisation evaluation and oracle naming.
import { findLegend } from '../src/engine/legendArea';
import { findLegendSwatches } from '../src/engine/legendSwatches';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve('../research/out/auto-swatches');
mkdirSync(out, { recursive: true });
const results = [];
for (const [key, sample, original] of PAIRS)
    for (const [which, file] of [['sample', sample], ['original', original]]) {
        const img = load(file), rec = recognise(img, render), area = findLegend(img, rec);
        const detected = area ? findLegendSwatches(img, area, rec.grid.perX) : [], scale = img.width / SAMPLE_WIDTH[key];
        const annotations = SWATCHES[key].flatMap(row => row.codes.map((code, i) => ({ code, x: row.x[i] * scale, y: row.y * scale })));
        const contains = (s: typeof detected[number], a: typeof annotations[number]) =>
            a.x >= s.rect.x && a.x <= s.rect.x + s.rect.w && a.y >= s.rect.y && a.y <= s.rect.y + s.rect.h;
        const coverage = detected.map(s => annotations.filter(a => contains(s, a)));
        const refs = new Map<string, number[]>(), used = new Set<number>();
        const matched = new Set<typeof annotations[number]>();
        for (const a of annotations) {
            const matches = detected.map((s, i) => ({ s, i })).filter(({ s }) => contains(s, a));
            if (matches.length !== 1 || coverage[matches[0].i].length !== 1)
                continue; // Reject merged boxes and ambiguous overlapping detections.
            const { s, i } = matches[0];
            used.add(i);
            matched.add(a);
            if (!a.code.startsWith('?'))
                refs.set(a.code, [s.colour.r, s.colour.g, s.colour.b]);
        }
        const located = matched.size;
        const cells = refs.size ? swatchCells(rec, refs) : [], legend = LEGEND[key];
        const row = { key, which, file, area, detected: detected.length, located, expected: annotations.length, unmatched: detected.length - used.size, usableCodes: refs.size, agreement: legend && refs.size ? agreement(tally(cells), legend) : null, spot: !legend && refs.size ? audit.labels.filter(l => cells[l.index] === l.code).length : null, swatches: detected, ambiguousBoxes: coverage.filter(a => a.length > 1).length, missed: annotations.filter(a => !matched.has(a)).map(a => a.code) };
        results.push(row);
        console.log(JSON.stringify({ ...row, swatches: undefined }));
        const canvas = createCanvas(img.width, img.height), ctx = canvas.getContext('2d'), px = ctx.createImageData(img.width, img.height);
        px.data.set(img.data);
        ctx.putImageData(px, 0, 0);
        detected.forEach((s, i) => { ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 2; ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h); ctx.strokeStyle = '#00aa00'; ctx.strokeRect(s.sampleRect.x, s.sampleRect.y, s.sampleRect.w, s.sampleRect.h); ctx.font = '12px Arial'; ctx.fillStyle = '#ff0000'; ctx.fillText(String(i + 1), s.rect.x, s.rect.y); });
        writeFileSync(resolve(out, `${key}-${which}.png`), canvas.toBuffer('image/png'));
    }
writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
