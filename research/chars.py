"""WORK IN PROGRESS, not used by recognize.py yet: read labels in the chart's own typeface.

Matching whole labels against system fonts breaks on charts printed in an unusual face (pixel
fonts): look-alike codes swap. But inside one chart every '3' is the same shape, so labels are cut
into characters, identical shapes are pooled across all colour groups, and each shape is then
assigned the character that makes the whole chart consistent.

Status: only the character cutting exists, and it miscounts characters on small-cell charts
(often one too many), so the pooling and assignment steps are not written.
"""
import numpy as np
from PIL import Image

from engine import INK

CW, CH = 10, 14   # every character is normalised to this box
EDGE = 3          # grid-line ink lives at the cell edge


def segment(stack):
    """Stacked label -> list of (x0, x1, y0, y1) character boxes, left to right."""
    m = stack[EDGE:INK - EDGE, EDGE:INK - EDGE]
    m = (m - np.median(m)) / (m.max() - np.median(m) + 1e-6)
    ink = m > 0.38
    rows = np.where(ink.sum(axis=1) >= 2)[0]
    if len(rows) < 4:
        return []
    # the label is the tallest contiguous band of inked rows
    bands, start = [], rows[0]
    for a, b in zip(rows[:-1], rows[1:]):
        if b - a > 1:
            bands.append((start, a))
            start = b
    bands.append((start, rows[-1]))
    y0, y1 = max(bands, key=lambda t: t[1] - t[0])
    if y1 - y0 < 5:
        return []
    prof = m[y0:y1 + 1].clip(0, 1).sum(axis=0)
    on = prof > 0.12 * prof.max() + 0.25
    runs, x = [], 0
    while x < len(on):
        if on[x]:
            x1 = x
            while x1 + 1 < len(on) and on[x1 + 1]:
                x1 += 1
            runs.append([x, x1])
            x = x1 + 1
        x += 1
    runs = [r for r in runs if r[1] - r[0] >= 1]
    if not runs:
        return []
    # two characters that touch: split a run that is much wider than the label is tall allows
    h = y1 - y0 + 1
    out = []
    for a, b in runs:
        w = b - a + 1
        parts = max(1, int(round(w / (0.72 * h)))) if w > 1.05 * h else 1
        if parts == 1:
            out.append((a, b))
        else:
            cuts = [a]
            for k in range(1, parts):
                guess = a + int(round(k * w / parts))
                lo, hi = max(a + 1, guess - 2), min(b - 1, guess + 2)
                cuts.append(lo + int(np.argmin(prof[lo:hi + 1])))
            cuts.append(b + 1)
            out += [(cuts[i], cuts[i + 1] - 1) for i in range(parts)]
    return [(a + EDGE, b + EDGE, y0 + EDGE, y1 + EDGE) for a, b in out]


def glyph(stack, box):
    x0, x1, y0, y1 = box
    crop = stack[y0:y1 + 1, x0:x1 + 1]
    im = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8)).resize((CW, CH), Image.BILINEAR)
    g = np.asarray(im).astype(np.float32)
    g = g - g.mean()
    return g / (np.linalg.norm(g) + 1e-6), (x1 - x0 + 1) / (y1 - y0 + 1)
