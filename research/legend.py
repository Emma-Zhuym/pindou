"""Use the chart's legend without reading its small print.

The legend is a row (or a few rows) of colour swatches drawn in exactly the colours the board uses.
Finding the swatches gives three things for free:
  - how many colours the chart really has, and what each looks like (so tinted fragments of one
    colour are merged and look-alike colours are kept apart),
  - which colours exist that the board pass missed,
  - the order of the codes: most apps print the legend sorted by code, so the names read off the
    board must come out in increasing order along the legend.
"""
import numpy as np

from glyphs import ALL

_LETTERS = sorted({c.rstrip('0123456789') for c in ALL})


def code_key(code):
    head = code.rstrip('0123456789')
    return (_LETTERS.index(head), int(code[len(head):] or 0))


ORDERED = sorted(ALL, key=code_key)


def locate(reg, colour, pitch):
    """Where in the legend strip `reg` is the swatch of this board colour? -> (cx, cy, w, h, n) or None.

    Looking for a known colour is far more reliable than detecting boxes blind: swatches can be
    a few pixels tall with a label covering most of them.
    """
    mask = np.abs(reg - colour).sum(axis=2) < 26
    cols = mask.sum(axis=0)
    best = None
    x = 0
    W = mask.shape[1]
    while x < W:
        if cols[x] < 2:
            x += 1
            continue
        x1 = x
        gap = 0
        while x1 < W and gap <= 2:               # tolerate label strokes splitting the swatch
            gap = gap + 1 if cols[x1] < 2 else 0
            x1 += 1
        x1 -= gap
        rows = np.where(mask[:, x:x1].sum(axis=1) >= max(2, 0.3 * (x1 - x)))[0]
        if len(rows):
            n = int(mask[rows[0]:rows[-1] + 1, x:x1].sum())
            w, h = x1 - x, rows[-1] - rows[0] + 1
            if w <= 6 * pitch and (best is None or n > best[4]):
                best = ((x + x1) / 2, (rows[0] + rows[-1]) / 2, w, h, n)
        x = x1 + 1
    if best is None or best[4] < max(8, 0.12 * pitch * pitch) or best[2] < 4 or best[3] < 3:
        return None
    return best


def reading_order(points):
    """Indices of (cx, cy, h) points sorted into lines, then left to right."""
    if not points:
        return []
    idx = sorted(range(len(points)), key=lambda i: points[i][1])
    h = np.median([p[2] for p in points])
    lines, cur = [], [idx[0]]
    for i in idx[1:]:
        if points[i][1] - points[cur[-1]][1] > max(4, 0.8 * h):
            lines.append(cur)
            cur = []
        cur.append(i)
    lines.append(cur)
    return [i for line in lines for i in sorted(line, key=lambda i: points[i][0])]


def name_in_order(score_rows):
    """Best strictly-increasing code sequence for groups listed in legend order.

    score_rows[i][k] = how well group i reads as ORDERED[k]. Returns (codes, total score).
    """
    n, m = len(score_rows), len(ORDERED)
    S = np.asarray(score_rows, dtype=np.float64)
    best = np.full((n, m), -1e9)
    back = np.zeros((n, m), int)
    best[0] = S[0]
    for i in range(1, n):
        run, arg = -1e9, 0
        for k in range(m):
            if k > 0 and best[i - 1, k - 1] > run:
                run, arg = best[i - 1, k - 1], k - 1
            best[i, k] = run + S[i, k]
            back[i, k] = arg
    k = int(np.argmax(best[-1]))
    total = float(best[-1, k])
    path = [k]
    for i in range(n - 1, 0, -1):
        k = back[i, k]
        path.append(k)
    return [ORDERED[k] for k in reversed(path)], total


# ---------------------------------------------------------------- reading the legend text

def read_legend(im, y0):
    """OCR the legend strip -> (codes, pairs): the set of codes seen, and {code: count} where a
    count could be tied to a code. Partial results are expected and fine: they are used as hints.
    """
    import json
    import re
    import subprocess
    from pathlib import Path

    from PIL import Image, ImageFilter

    from labels import normalise

    here = Path(__file__).resolve().parent
    W, H = im.size
    strip = im.crop((0, int(y0), W, H))
    tokens = []  # (text, cx, cy, w, h) in strip pixels
    for scale in (3, 5):
        big = strip.resize((strip.width * scale, strip.height * scale), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 120, 2))
        pad = Image.new('RGB', (big.width + 80, big.height + 80), 'white')
        pad.paste(big, (40, 40))
        path = here / 'out' / 'legend_tmp.png'
        pad.save(path)
        res = json.loads(subprocess.run([str(here / 'out' / 'ocr'), str(path)], capture_output=True, text=True).stdout or '[]')
        for e in res:
            # spread a multi-word line over its box so each word gets its own position
            words = e['t'].split()
            x0, bw = e['x'] * pad.width - 40, e['w'] * pad.width
            cy, bh = (e['y'] + e['h'] / 2) * pad.height - 40, e['h'] * pad.height
            total = sum(len(w) for w in words) + len(words) - 1
            pos = 0
            for w in words:
                cx = x0 + bw * (pos + len(w) / 2) / max(1, total)
                tokens.append((w, cx / scale, cy / scale, bw * len(w) / max(1, total) / scale, bh / scale))
                pos += len(w) + 1

    def as_count(t):
        t2 = ''.join({'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 'B': '8', 'Z': '2'}.get(ch, ch) for ch in t)
        return int(t2) if re.fullmatch(r'\d{1,5}', t2) else None

    codes, counts = [], []
    for t, cx, cy, w, h in tokens:
        if re.fullmatch(r'\d{1,5}', t):
            counts.append((int(t), cx, cy, h))
            continue
        c = normalise(t)
        if c:
            codes.append((c, cx, cy, h))
        elif as_count(t) is not None:
            counts.append((as_count(t), cx, cy, h))
    # a purely numeric token can still be a misread code ("830" for B30): keep it as a count here,
    # the board evidence decides later
    pairs = {}
    for c, cx, cy, h in codes:
        best = None
        for n, nx, ny, nh in counts:
            right = abs(ny - cy) < 0.7 * max(h, nh) and 0 < nx - cx < 6 * max(h, nh)
            below = 0 < ny - cy < 3.5 * max(h, nh) and abs(nx - cx) < 1.5 * max(h, nh)
            if right or below:
                d = abs(nx - cx) + abs(ny - cy)
                if best is None or d < best[0]:
                    best = (d, n)
        if best:
            pairs.setdefault(c, set()).add(best[1])
    return {c for c, *_ in codes}, pairs, sorted({n for n, *_ in counts})
