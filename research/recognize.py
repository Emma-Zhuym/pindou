"""Full automatic pass over one chart, scored against its legend when the legend is known.

    python recognize.py dog          # one sample
    python recognize.py              # all samples
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from engine import INK, find_board, find_grid, greedy, load, read_cells
from geometry import geometry
from glyphs import ALL, B, fit, make_reader
from legend import read_legend

HERE = Path(__file__).resolve().parent
HEX = {}
for hx, v in json.load(open(HERE / 'data' / 'mard_zippland.json')).items():
    m = re.match(r'^([A-Z]+)0*(\d+)$', v['MARD'])
    HEX[m.group(1) + m.group(2) if m else v['MARD']] = np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], np.float32)

# size and legend are only used for scoring; nothing here is fed to the recogniser
SAMPLES = {
    'dog': dict(file='dog-104x104.jpg', size=(104, 104),
                legend={'A1': 3150, 'H2': 1599, 'H7': 1548, 'F21': 1258, 'G12': 738, 'A11': 634, 'E4': 466, 'B30': 345,
                        'E18': 334, 'B17': 178, 'C17': 155, 'C26': 116, 'B13': 96, 'F13': 64, 'M2': 36, 'M3': 33,
                        'F23': 31, 'F19': 19, 'F14': 16}),
    'tree': dict(file='tree-52x64.jpg', size=(52, 64), gaps=True,
                 legend={'B23': 637, 'B17': 362, 'B11': 214, 'H7': 210, 'B32': 66, 'B15': 59, 'B29': 43, 'H16': 16,
                         'G17': 13, 'H2': 5, 'B22': 3, 'F11': 3, 'H17': 1}),
    'landscape': dict(file='landscape-84x84.jpg', size=(84, 84),
                      legend={'A3': 118, 'A6': 176, 'A7': 287, 'A8': 320, 'A15': 757, 'A22': 24, 'A26': 48, 'B1': 267, 'B7': 80,
                              'B8': 557, 'B9': 447, 'B11': 143, 'B13': 100, 'B15': 55, 'B18': 78, 'B19': 125, 'B21': 60,
                              'B26': 171, 'B29': 151, 'B32': 499, 'C3': 190, 'C19': 77, 'C24': 731, 'C27': 76, 'F8': 138,
                              'F10': 94, 'F11': 132, 'F13': 328, 'F19': 29, 'G7': 206, 'G8': 135, 'G13': 35, 'G17': 22,
                              'G19': 265, 'H12': 135}),
    'portrait': dict(file='portrait-50x70.jpg', size=(50, 70), legend=None),
}


def unit(m):
    m = m[..., B:INK - B, B:INK - B]
    m = m - m.mean(axis=(-1, -2), keepdims=True)
    return m / (np.linalg.norm(m, axis=(-1, -2), keepdims=True) + 1e-6)


def name_group(read, stack, colour, n=0, hint=None):
    """Glyph match first; among near-ties the code whose catalogue colour is closest wins."""
    scores = read.all(stack)
    cd = np.array([np.abs(HEX[c] - colour).sum() for c in ALL])
    # the label decides; catalogue colour only settles look-alike digits (H2/H3, E16/E18) and
    # vetoes codes whose bead colour is nowhere near this fill
    total = scores - cd / 1500.0 - (cd > 170) * 1.0
    if hint and hint['codes']:
        # whatever could be read off the legend is a hint, not a rule: OCR of small print is patchy
        for k, c in enumerate(ALL):
            if c in hint['codes']:
                total[k] += 0.05
                if any(abs(v - n) <= max(3, 0.12 * v) for v in hint['pairs'].get(c, [])):
                    total[k] += 0.05
    i = int(np.argmax(total))
    code, top = ALL[i], scores[i]
    return code, float(top), float(np.abs(HEX[code] - colour).sum())


def read_ok(stack):
    """A stack with a real label has clear dark-on-light structure in the middle of the cell."""
    m = stack[B:INK - B, B:INK - B]
    return m.max() - np.median(m) > 0.25


def recognise(key, verbose=True, use_legend=True):
    cfg = SAMPLES[key]
    geo = geometry(key, cfg['file'])
    grid = geo['grid']
    cache = HERE / 'out' / f'{key}.npz'
    if cache.exists():
        z = np.load(cache)
        fill, ink, share = z['fill'], z['ink'], z['share']
    else:
        im, a = load(cfg['file'])
        fill, ink, share = read_cells(im, a, grid, geo['r0'], geo['c0'], geo['nr'], geo['nc'])
        np.savez(cache, fill=fill, ink=ink, share=share)
    hint_path = HERE / 'out' / f'{key}.legend.json'
    if hint_path.exists():
        hint = json.load(open(hint_path))
    else:
        im, _ = load(cfg['file'])
        lc, lp, _ = read_legend(im, grid[3] + (geo['r0'] + geo['nr']) * grid[2] + 2)
        hint = dict(codes=sorted(lc), pairs={c: sorted(v) for c, v in lp.items()})
        json.dump(hint, open(hint_path, 'w'))
    if not use_legend:
        hint = dict(codes=[], pairs={})

    # the numbered border, where a chart has one, is a flat colour that the picture itself does not use
    def is_border(line, inner):
        med = np.median(line, axis=0)
        flat = (np.abs(line - med).sum(axis=1) < 30).mean()
        inside = (np.abs(inner.reshape(-1, 3) - med).sum(axis=1) < 30).mean()
        return flat > 0.8 and inside < 0.02

    t, b, l, r = 0, fill.shape[0], 0, fill.shape[1]
    inner = fill[2:-2, 2:-2]
    if is_border(fill[t, 2:-2], inner): t += 1
    if is_border(fill[b - 1, 2:-2], inner): b -= 1
    if is_border(fill[2:-2, l], inner): l += 1
    if is_border(fill[2:-2, r - 1], inner): r -= 1
    fill, ink, share = fill[t:b, l:r], ink[t:b, l:r], share[t:b, l:r]
    rows, cols = fill.shape[:2]
    size_ok = (cols, rows) == tuple(cfg['size'])
    F = fill.reshape(-1, 3)
    K = ink.reshape(-1, INK, INK)
    U = unit(K).reshape(len(K), -1)
    n = len(F)

    # 1. colour groups, 2. read each group's stacked label, 3. merge groups that carry the same code
    cents, counts, lab = greedy(F, 26)
    order = [int(j) for j in np.argsort(-counts)]
    stacks = {j: K[lab == j].mean(axis=0) for j in order}
    major = max(8, int(0.002 * n))  # a group this large is a colour of its own, not a tinted fragment
    seeds = [j for j in order if counts[j] >= major and read_ok(stacks[j])][:8]
    params, avg = fit([stacks[j] for j in seeds])
    read = make_reader(params)
    groups = {}  # code -> list of cluster ids
    for j in order:
        scores = read.all(stacks[j])
        code, score, cdist = name_group(read, stacks[j], cents[j], counts[j], hint)
        # do the member cells agree with their own average? watermark debris does not
        coh = float((U[lab == j] @ unit(stacks[j]).reshape(-1)).mean()) if counts[j] >= 3 else 1.0
        verdict = 'skip'
        if counts[j] >= major:
            if score >= 0.86 and cdist < 170:
                verdict = 'new'
        else:
            near = []
            for c in groups:
                d = np.abs(cents[groups[c][0]] - cents[j]).sum()
                gap = score - scores[ALL.index(c)]
                # a tinted fragment of an existing colour reads (almost) the same label; a different
                # code in a similar colour (F13 vs F19) reads measurably worse
                if (d < 40 and gap <= 0.06) or (d < 70 and gap <= 0.015):
                    near.append(c)
            if near:
                code = max(near, key=lambda c: scores[ALL.index(c)])
                verdict = 'merge'
            elif score >= 0.9 and coh >= 0.5 and cdist < 120:
                verdict = 'new'
        if verbose > 1 and (counts[j] >= 3 or verdict == 'new'):
            print(f'     n={counts[j]:5d} rgb {tuple(int(v) for v in cents[j])} -> {code:4s} glyph {score:.2f} colour-off {cdist:3.0f} agree {coh:.2f}  {verdict}')
        if verdict != 'skip':
            groups.setdefault(code, []).append(j)
    codes = sorted(groups)
    centre = np.array([np.average(cents[groups[c]], axis=0, weights=counts[groups[c]]) for c in codes])
    templ = np.stack([unit(np.average([stacks[j] for j in groups[c]], axis=0, weights=counts[groups[c]])).reshape(-1) for c in codes])

    # 4. every cell picks the code whose colour AND label shape fit it best
    cdist = np.abs(F[:, None, :] - centre[None, :, :]).sum(axis=2)       # (cells, codes)
    corr = U @ templ.T                                                   # (cells, codes)
    score = corr - cdist / 120.0
    # a cell whose colour fits no group is probably under a watermark: its tint is not evidence,
    # so let the label shape decide and only use colour as a weak hint
    odd = cdist.min(axis=1) > 45
    score[odd] = corr[odd] - cdist[odd] / 500.0
    o = np.argsort(-score, axis=1)
    pick = o[:, 0]
    margin = score[np.arange(n), o[:, 0]] - score[np.arange(n), o[:, 1]] if len(codes) > 1 else np.ones(n)
    best_corr = corr[np.arange(n), pick]
    best_cd = cdist[np.arange(n), pick]

    bead = np.ones(n, bool)
    if cfg.get('gaps'):
        # a bead cell always carries a label; gaps are blank (or blank under a watermark)
        bead = (share.reshape(-1) > 0.06) & (best_corr > 0.35)
    unsure = bead & ((margin < 0.12) | (best_corr < 0.3) | (best_cd > 90))

    found = Counter(codes[i] for i in pick[bead])
    if verbose:
        print(f'== {key}: board found {cols}x{rows} ({"matches" if size_ok else "EXPECTED %dx%d" % tuple(cfg["size"])}), label fit {avg:.3f}, {len(codes)} codes found, {int(bead.sum())} beads, {int(unsure.sum())} flagged for checking')
        leg = cfg['legend']
        if leg:
            off = 0
            for c in sorted(set(leg) | set(found), key=lambda c: -leg.get(c, 0)):
                g, t = found.get(c, 0), leg.get(c, 0)
                off += abs(g - t)
                print(f'   {c:4s} legend {t:5d}  found {g:5d}  {"ok" if g == t else f"{g - t:+d}"}')
            tot = sum(leg.values())
            print(f'   -> {off / 2:.0f} of {tot} beads off: {100 * (1 - off / 2 / tot):.2f}% right by count')
        else:
            print('   ' + '  '.join(f'{c} {k}' for c, k in found.most_common()))
    return dict(codes=codes, pick=pick, bead=bead, unsure=unsure, found=found)


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('-')]
    for k in (args or list(SAMPLES)):
        recognise(k, verbose=2 if '-v' in sys.argv else 1, use_legend='--no-legend' not in sys.argv)
