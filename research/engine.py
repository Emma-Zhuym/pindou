"""Bead-chart recognition prototype.

Pipeline: find the grid -> read every cell (fill colour + label ink) -> group cells -> name groups.
Kept in numpy so each step can be scored against the sample charts before it is ported to the app.
"""
from pathlib import Path

import numpy as np
from PIL import Image

SAMPLES = Path(__file__).resolve().parent.parent / 'samples'
INK = 40  # label ink is resampled to INK x INK per cell so cells of any size compare directly


def load(name):
    im = Image.open(SAMPLES / name).convert('RGB')
    return im, np.asarray(im).astype(np.float32)


# ---------------------------------------------------------------- grid

def _profile(a, axis):
    g = np.abs(np.diff(a, axis=1 - axis)).sum(axis=2)
    p = g.sum(axis=axis)
    p = p - np.median(p)
    return np.clip(p, 0, np.percentile(p, 99))  # thick every-5th lines must not outvote thin ones


def _line_values(p, per, off):
    k = np.arange(0, int((len(p) - off) / per))
    idx = np.round(off + k * per).astype(int)
    return p[idx[(idx >= 0) & (idx < len(p))]]


def find_grid(a, lo=7.0, hi=45.0):
    """Cell pitch and phase for both axes.

    A real pitch has a line at (almost) every predicted position, so candidates are judged by the
    weak end of their line strengths: half the true pitch lands on label text every other step and
    fails, while multiples of the true pitch pass, so the smallest passing pitch is the cell size.
    """
    px, py = _profile(a, 0), _profile(a, 1)
    pers = np.arange(lo, hi, 0.02)

    def axis_score(p):
        out = np.zeros(len(pers))
        for i, per in enumerate(pers):
            out[i] = max(np.percentile(_line_values(p, per, o), 40) for o in np.arange(0, per, 0.5))
        return out / out.max()

    comb = axis_score(px) + axis_score(py)
    i = int(np.argmax(comb >= 0.62 * comb.max()))
    while i + 1 < len(pers) and comb[i + 1] >= comb[i]:
        i += 1
    per = pers[i]

    def fine(p):
        best = (-1.0, per, 0.0)
        for dp in np.arange(-0.08, 0.08, 0.002):
            for o in np.arange(0, per + dp, 0.1):
                s = _line_values(p, per + dp, o).mean()
                if s > best[0]:
                    best = (s, per + dp, o)
        return best[1], best[2]

    def centre(p, per, off):
        """The fit locks onto one edge of each grid line; move to the middle of the line so that a
        cell box starts and ends on line centres and labels are not clipped."""
        ds = np.arange(-2, 3)
        fold = np.array([_line_values(p, per, off + d).mean() if off + d >= 0 else 0 for d in ds])
        main = fold[2]
        fold[2] = 0
        j = int(np.argmax(fold))
        d2 = ds[j] if fold[j] >= 0.35 * main else 0
        return (off + d2 / 2 + 0.5) % per

    (perx, offx), (pery, offy) = fine(px), fine(py)
    return perx, centre(px, perx, offx), pery, centre(py, pery, offy)


def find_board(a, grid):
    """Extent of the gridded area, in whole cells: (first_row, first_col, n_rows, n_cols).

    Grid lines only exist where the chart is, so along each axis we look for the stretch where the
    lines of the other axis are actually present.
    """
    perx, offx, pery, offy = grid

    def extent(axis, per, off, per_other, off_other):
        g = np.abs(np.diff(a, axis=1 - axis)).sum(axis=2)          # edges across the lines of this axis
        if axis == 1:
            g = g.T                                                 # -> (position along lines, position across)
        n_across = g.shape[1]
        k = np.arange(0, int((n_across - off) / per) + 1)
        idx = np.round(off + k * per).astype(int)
        idx = idx[(idx >= 2) & (idx < n_across - 2)]
        on = np.maximum.reduce([g[:, idx - 1], g[:, idx], g[:, idx + 1], g[:, idx - 2]])   # at the lines
        mid = np.round(off + (k[:len(idx)] + 0.5) * per).astype(int)
        mid = mid[(mid >= 0) & (mid < n_across)]
        sig = np.percentile(on, 65, axis=1)                         # a line at a good share of the positions?
        thr = 0.3 * np.percentile(sig, 70)
        inside = sig > thr
        # longest run, tolerating short dropouts (rows that happen to lie on a horizontal line)
        best, start, gap, cur = (0, 0), None, 0, 0
        for i, v in enumerate(list(inside) + [False] * 6):
            if v:
                if start is None:
                    start = i
                gap = 0
                cur = i
            elif start is not None:
                gap += 1
                if gap > 5:
                    if cur - start > best[1] - best[0]:
                        best = (start, cur + 1)
                    start = None
        first = int(round((best[0] - off_other) / per_other))
        count = int(round((best[1] - best[0]) / per_other))
        return first, count

    r_first, n_rows = extent(0, perx, offx, pery, offy)   # vertical lines present on which rows
    c_first, n_cols = extent(1, pery, offy, perx, offx)   # horizontal lines present on which columns
    return r_first, c_first, n_rows, n_cols


# ---------------------------------------------------------------- cells

def read_cells(im, a, grid, r0, c0, rows, cols, inset=0.16):
    """Fill colour, label-ink map and ink share for each board cell."""
    perx, offx, pery, offy = grid
    fill = np.zeros((rows, cols, 3), np.float32)
    ink = np.zeros((rows, cols, INK, INK), np.float32)
    share = np.zeros((rows, cols), np.float32)
    for r in range(rows):
        for c in range(cols):
            x0, y0 = offx + (c0 + c) * perx, offy + (r0 + r) * pery
            blk = a[int(round(y0 + pery * inset)):int(round(y0 + pery * (1 - inset))),
                    int(round(x0 + perx * inset)):int(round(x0 + perx * (1 - inset)))].reshape(-1, 3)
            if len(blk) > 144:
                blk = blk[:: len(blk) // 144 + 1]
            near = np.abs(blk[:, None, :] - blk[None, :, :]).sum(axis=2) < 30
            j = int(np.argmax(near.sum(axis=1)))  # the pixel with the most look-alikes is the fill
            f = blk[near[j]].mean(axis=0)
            fill[r, c] = f
            share[r, c] = 1 - near[j].mean()
            # sub-pixel resample of the whole cell, then "how unlike the fill is each point"
            patch = im.resize((INK, INK), Image.BILINEAR, box=(x0, y0, x0 + perx, y0 + pery))
            d = np.abs(np.asarray(patch).astype(np.float32) - f).sum(axis=2)
            ink[r, c] = np.clip(d / 255.0, 0, 1)
    return fill, ink, share


def greedy(pts, thr):
    cents, counts, lab = [], [], np.zeros(len(pts), int)
    for i, p in enumerate(pts):
        if cents:
            d = np.abs(np.array(cents) - p).sum(axis=1)
            j = int(np.argmin(d))
            if d[j] < thr:
                cents[j] = (cents[j] * counts[j] + p) / (counts[j] + 1)
                counts[j] += 1
                lab[i] = j
                continue
        cents.append(p.astype(np.float64).copy())
        counts.append(1)
        lab[i] = len(cents) - 1
    return np.array(cents), np.array(counts), lab
