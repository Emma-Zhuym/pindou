// synthetic checks independent of the four screenshot fixtures.
import assert from 'node:assert/strict';
import { findLegendSwatches, sampleSwatch } from '../src/engine/legendSwatches';
import type { Raster } from '../src/engine/grid';
const image = (width: number, height: number): Raster => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });
const paint = (img: Raster, x: number, y: number, w: number, h: number, c: number[]) => {
    for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
            const i = (yy * img.width + xx) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
        }
};
const blank = image(100, 45);
assert.deepEqual(findLegendSwatches(blank, { x: 0, y: 0, w: 100, h: 45 }, 12), []);
assert.deepEqual(findLegendSwatches(blank, { x: 110, y: 50, w: 20, h: 20 }, 12), []);
const img = image(100, 45), colours = [[180, 40, 50], [25, 120, 65], [249, 249, 242]];
colours.forEach((c, i) => { const x = 6 + i * 28; paint(img, x, 8, 20, 20, [90, 90, 90]); paint(img, x + 1, 9, 18, 18, c); paint(img, x + 7, 14, 3, 8, [20, 20, 20]); });
const detected = findLegendSwatches(img, { x: 0, y: 0, w: 100, h: 45 }, 12);
assert.equal(detected.length, 3, 'three outlined swatches including near-white');
colours.forEach((c, i) => {
    const s = detected.find(s => s.rect.x <= 16 + i * 28 && s.rect.x + s.rect.w >= 16 + i * 28);
    assert.ok(s, 'known centre covered');
    assert.ok([s.colour.r, s.colour.g, s.colour.b].every((v, ch) => Math.abs(v - c[ch]) < 2), 'text does not become fill');
});
const shifted = image(120, 65);
for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
        const from = (y * img.width + x) * 4, to = ((y + 10) * shifted.width + x + 10) * 4;
        shifted.data.set(img.data.slice(from, from + 4), to);
    }
const moved = findLegendSwatches(shifted, { x: 10, y: 10, w: 100, h: 45 }, 12);
assert.deepEqual(moved.map(s => s.colour), detected.map(s => s.colour), 'translation preserves fill colours');
assert.deepEqual(moved.map(s => ({ x: s.rect.x - 10, y: s.rect.y - 10, w: s.rect.w, h: s.rect.h })), detected.map(s => s.rect), 'coordinates are absolute');
console.log('Legend swatches: blank/outside, coloured + pale outlines, text contamination, translation checks passed');
const long = image(160, 40);
colours.forEach((c, i) => {
    const x = 4 + i * 50;
    paint(long, x, 9, 44, 16, [90, 90, 90]);
    paint(long, x + 1, 10, 42, 14, [255, 255, 255]);
    paint(long, x + 1, 10, 18, 14, c);
    paint(long, x + 8, 13, 2, 8, [20, 20, 20]);
    paint(long, x + 28, 13, 2, 8, [20, 20, 20]);
});
const compartments = findLegendSwatches(long, { x: 0, y: 0, w: 160, h: 40 }, 12);
assert.equal(compartments.length, 3, 'three swatch/count compartments');
colours.forEach((c, i) => assert.ok([compartments[i].colour.r, compartments[i].colour.g, compartments[i].colour.b].every((v, ch) => Math.abs(v - c[ch]) < 2), 'count background must not become fill'));
console.log('Long swatch/count compartment checks passed');

const cropped = sampleSwatch(blank, { x: -4, y: -4, w: 20, h: 20 });
assert.deepEqual(cropped.sampleRect, { x: 0, y: 0, w: 16, h: 16 });
assert.deepEqual(cropped.colour, { r: 255, g: 255, b: 255 });
assert.throws(() => sampleSwatch(blank, { x: 110, y: 0, w: 10, h: 10 }), RangeError);
console.log('Sampling clips partial boxes and rejects empty interiors');
