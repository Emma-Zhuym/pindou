// experimental detector. Input contains no sample coordinates or colour-code names.
import type { Raster } from './grid';
import type { Rect } from './legendArea';
import type { Rgb } from './glyphs';
export interface LegendSwatch {
    rect: Rect;
    sampleRect: Rect;
    colour: Rgb;
    fillShare: number;
}
export function findLegendSwatches(img: Raster, area: Rect, pitch: number): LegendSwatch[] {
    const x0 = Math.max(0, Math.floor(area.x)), y0 = Math.max(0, Math.floor(area.y));
    const W = Math.max(0, Math.min(img.width, Math.ceil(area.x + area.w)) - x0), H = Math.max(0, Math.min(img.height, Math.ceil(area.y + area.h)) - y0);
    if (!W || !H)
        return [];
    const minH = Math.max(6, pitch * .65), boxes: Rect[] = [], queue = new Int32Array(W * H);
    // Multiple thresholds detect pale outlines as well as coloured fills.
    for (const threshold of [180, 210, 235]) {
        const mask = new Uint8Array(W * H);
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const i = ((y0 + y) * img.width + x0 + x) * 4;
                mask[y * W + x] = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) < threshold ? 1 : 0;
            }
        for (let start = 0; start < mask.length; start++) {
            if (!mask[start])
                continue;
            let head = 0, tail = 1, xa = W, xb = 0, ya = H, yb = 0;
            queue[0] = start;
            mask[start] = 0;
            while (head < tail) {
                const p = queue[head++], x = p % W, y = Math.floor(p / W);
                xa = Math.min(xa, x);
                xb = Math.max(xb, x);
                ya = Math.min(ya, y);
                yb = Math.max(yb, y);
                for (const q of [x > 0 ? p - 1 : -1, x + 1 < W ? p + 1 : -1, y > 0 ? p - W : -1, y + 1 < H ? p + W : -1]) {
                    if (q >= 0 && mask[q]) {
                        mask[q] = 0;
                        queue[tail++] = q;
                    }
                }
            }
            const w = xb - xa + 1, h = yb - ya + 1;
            if (h < minH || h > pitch * 3 || w < minH * .6 || w / h > 5 || w / h < .5 || tail < w * h * .12)
                continue;
            boxes.push({ x: x0 + xa, y: y0 + ya, w, h });
        }
    }
    boxes.sort((a, b) => b.w * b.h - a.w * a.h);
    const unique: Rect[] = [];
    for (const b of boxes) {
        if (unique.some(a => {
            const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            return overlap / Math.min(a.w * a.h, b.w * b.h) > .6;
        }))
            continue;
        unique.push(b);
    }
    // Repeated similar-height patches in a row; isolated text/watermarks are rejected.
    const supported = unique.filter(b => unique.filter(a => Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < Math.min(a.h, b.h) * .35 && Math.abs(a.h - b.h) < Math.max(a.h, b.h) * .4).length >= 3);
    // Repeated compact boxes establish a row lattice; split contours joined by JPEG ringing.
    const refined: Rect[] = [];
    const pending = [...supported];
    while (pending.length) {
        const first = pending.shift()!, row = [first];
        for (let i = pending.length - 1; i >= 0; i--)
            if (Math.abs(pending[i].y + pending[i].h / 2 - first.y - first.h / 2) < first.h * .35) {
                row.push(pending.splice(i, 1)[0]);
            }
        const compact = row.filter(b => b.w / b.h > .65 && b.w / b.h < 1.5).sort((a, b) => a.x - b.x);
        if (compact.length < 3) {
            refined.push(...row);
            continue;
        }
        const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
        const width = median(compact.map(b => b.w)), height = median(compact.map(b => b.h));
        const centres = compact.map(b => b.x + b.w / 2);
        let best = Infinity, step = width + 2, phase = centres[0];
        for (let d = width * .98; d < width * 1.25; d += .1)
            for (const c of centres) {
                const error = centres.reduce((sum, x) => sum + Math.min(Math.abs((x - c) / d - Math.round((x - c) / d)), .25) ** 2, 0);
                if (error < best) {
                    best = error;
                    step = d;
                    phase = c;
                }
            }
        const rowBoxes: Rect[] = [];
        for (const box of row) {
            if (box.w < step * 1.5) {
                rowBoxes.push(box);
                continue;
            }
            for (let k = Math.ceil((box.x - phase) / step); phase + k * step < box.x + box.w; k++) {
                const centre = phase + k * step;
                rowBoxes.push({ x: Math.round(centre - width / 2), y: Math.round(box.y + (box.h - height) / 2), w: Math.round(width), h: height });
            }
        }
        // Look for faint outlined slots missing from the threshold contours. A lattice alone
        // is insufficient: both vertical boundaries must have image-edge support.
        const left = Math.min(...row.map(b => b.x)), right = Math.max(...row.map(b => b.x + b.w));
        const top = median(row.map(b => b.y));
        const sideSupport = (cx: number, cy: number) => {
            let hits = 0, total = 0;
            for (let yy = Math.round(cy + height * .2); yy < cy + height * .8; yy++) {
                let edge = 0;
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = Math.round(cx) + dx;
                    if (xx < 1 || xx >= img.width || yy < 0 || yy >= img.height)
                        continue;
                    const i = (yy * img.width + xx) * 4;
                    edge = Math.max(edge, Math.abs(img.data[i] - img.data[i - 4]) + Math.abs(img.data[i + 1] - img.data[i - 3]) + Math.abs(img.data[i + 2] - img.data[i - 2]));
                }
                total++;
                if (edge > 24)
                    hits++;
            }
            return hits / Math.max(1, total);
        };
        for (let k = Math.ceil((left - phase) / step); phase + k * step < right; k++) {
            const centre = phase + k * step;
            if (rowBoxes.some(b => centre >= b.x && centre <= b.x + b.w))
                continue;
            const xa = Math.round(centre - width / 2);
            if (sideSupport(xa, top) > .45 && sideSupport(xa + width, top) > .45)
                rowBoxes.push({ x: xa, y: top, w: Math.round(width), h: height });
        }
        refined.push(...rowBoxes);
    }
    return refined.sort((a, b) => Math.abs(a.y - b.y) > Math.min(a.h, b.h) * .5 ? a.y - b.y : a.x - b.x).filter(r => r.x + r.w > 2 && r.y + r.h > 2 && r.x < img.width - 2 && r.y < img.height - 2).map(r => sampleSwatch(img, r));
}
export function sampleSwatch(img: Raster, rect: Rect): LegendSwatch {
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    let w = Math.min(img.width, Math.ceil(rect.x + rect.w)) - x;
    const h = Math.min(img.height, Math.ceil(rect.y + rect.h)) - y;
    if (w < 3 || h < 3)
        throw new RangeError('Swatch has no usable interior inside the image');
    // A long box can include a white count compartment. Keep its dense coloured strip.
    if (w > h * 1.8) {
        let best = -1, cut = Math.round(h * 1.4);
        for (let xx = Math.ceil(h * .7); xx < Math.min(w * .7, h * 1.8); xx++) {
            const edges: number[] = [];
            for (let yy = 2; yy < h - 2; yy++) {
                const i = ((y + yy) * img.width + x + xx) * 4;
                edges.push(Math.abs(img.data[i] - img.data[i - 4]) + Math.abs(img.data[i + 1] - img.data[i - 3]) + Math.abs(img.data[i + 2] - img.data[i - 2]));
            }
            edges.sort((a, b) => a - b);
            const strength = edges[Math.floor(edges.length * .4)] ?? 0;
            if (strength > best) {
                best = strength;
                cut = xx;
            }
        }
        w = Math.max(2, cut);
    }
    const pixels: number[][] = [], inset = Math.max(1, Math.floor(Math.min(w, h) * .12)), step = Math.max(1, Math.ceil(Math.sqrt(w * h / 400)));
    for (let yy = y + inset; yy < y + h - inset; yy += step)
        for (let xx = x + inset; xx < x + w - inset; xx += step) {
            const i = (yy * img.width + xx) * 4;
            pixels.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
        }
    let best: number[][] = [];
    for (const c of pixels) {
        const near = pixels.filter(p => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 24);
        if (near.length > best.length)
            best = near;
    }
    const mean = (ch: number) => best.reduce((s, p) => s + p[ch], 0) / Math.max(1, best.length);
    // fillShare is diagnostic, not a calibrated probability or an acceptance threshold.
    return { rect, sampleRect: { x, y, w, h }, colour: { r: mean(0), g: mean(1), b: mean(2) }, fillShare: best.length / Math.max(1, pixels.length) };
}
