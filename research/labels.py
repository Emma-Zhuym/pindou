"""Read the label of a group of cells by stacking their ink maps and running OCR on the result."""
import json
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

from engine import INK

HERE = Path(__file__).resolve().parent
_codes = set()
for v in json.load(open(HERE / 'data' / 'mard_zippland.json')).values():
    m = re.match(r'^([A-Z]+)0*(\d+)$', v['MARD'])
    _codes.add(m.group(1) + m.group(2) if m else v['MARD'])
CODES = _codes

_HEAD = {'8': 'B', '6': 'G', '0': 'D', '1': 'H', '5': 'S', '€': 'E', '£': 'E', 'I': 'H', 'N': 'M', 'K': 'H', 'P': 'F'}
_TAIL = {'O': '0', 'o': '0', 'D': '0', 'Q': '0', 'I': '1', 'l': '1', 'i': '1', '|': '1', 'T': '1', 'Z': '2', 'z': '2',
         'S': '5', 's': '5', 'B': '8', 'G': '6', 'b': '6', 'g': '9', 'q': '9', 'A': '4'}


def normalise(text):
    """OCR text -> a valid MARD code, or None."""
    t = re.sub(r'[^A-Za-z0-9€£|]', '', text)
    if len(t) < 2:
        return None
    tail = ''.join(_TAIL.get(ch, ch) for ch in t[1:])
    for head in (t[0].upper(), _HEAD.get(t[0], t[0]).upper()):
        if tail.isdigit() and head + str(int(tail)) in CODES:
            return head + str(int(tail))
    return None


def tile(stack, z=6):
    m = (stack - stack.min()) / (stack.max() - stack.min() + 1e-6)
    # drop the cell border so only the label is left for OCR
    b = max(2, INK // 14)
    m = m[b:INK - b, b:INK - b]
    m = np.clip((m - 0.35) / 0.3, 0, 1)  # stacking blurs the strokes; a hard-ish threshold brings the edges back
    t = Image.fromarray((255 - m * 255).astype(np.uint8)).resize((m.shape[1] * z, m.shape[0] * z), Image.BICUBIC)
    return t


def read_stacks(stacks, tag='tmp'):
    """OCR many stacked labels in one call: one tile per stack on a contact sheet."""
    tiles = [tile(s) for s in stacks]
    w, h = tiles[0].size
    pad, per_row = 60, 8
    rows = (len(tiles) + per_row - 1) // per_row
    sheet = Image.new('L', (per_row * (w + pad) + pad, rows * (h + pad) + pad), 255)
    for i, t in enumerate(tiles):
        sheet.paste(t, (pad + (i % per_row) * (w + pad), pad + (i // per_row) * (h + pad)))
    path = HERE / 'out' / f'sheet_{tag}.png'
    sheet.save(path)
    res = json.loads(subprocess.run([str(HERE / 'out' / 'ocr'), str(path)], capture_output=True, text=True).stdout or '[]')
    out = [None] * len(tiles)
    raw = [''] * len(tiles)
    for e in res:
        cx, cy = (e['x'] + e['w'] / 2) * sheet.width, (e['y'] + e['h'] / 2) * sheet.height
        i = int((cy - pad / 2) // (h + pad)) * per_row + int((cx - pad / 2) // (w + pad))
        if 0 <= i < len(tiles):
            raw[i] += e['t']
    for i, t in enumerate(raw):
        out[i] = normalise(t)
    return out, raw
