"""Name a stacked label by comparing it with every MARD code rendered as text.

A chart prints all its labels in one font, size and position, so those are fitted once per chart
on the biggest groups; after that naming a group is a 291-way comparison, not open-ended OCR.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from engine import INK
from labels import CODES

FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
         '/System/Library/Fonts/Supplemental/Verdana Bold.ttf', '/System/Library/Fonts/Supplemental/Tahoma Bold.ttf',
         '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf']
ALL = sorted(CODES)
SS = 4
B = 4  # ignore the cell border (grid lines) when comparing


def render(code, font, size, blur):
    img = Image.new('L', (INK * SS, INK * SS), 0)
    f = ImageFont.truetype(font, max(4, int(size * INK * SS)))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = d.textbbox((0, 0), code, font=f)
    d.text(((INK * SS - (x1 - x0)) / 2 - x0, (INK * SS - (y1 - y0)) / 2 - y0), code, fill=255, font=f)
    img = img.resize((INK, INK), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img).astype(np.float32) / 255


def _norm(m):
    m = m[B:INK - B, B:INK - B]
    m = m - m.mean()
    return m / (np.linalg.norm(m) + 1e-6)


def _bank(font, size, blur):
    return np.stack([_norm(render(c, font, size, blur)) for c in ALL])  # (codes, h, w)


def _shifted(stack, dx, dy):
    return _norm(np.roll(np.roll(stack, dy, axis=0), dx, axis=1))


def fit(stacks):
    """Font, size, blur and offset that explain the given (large) stacks best."""
    def total(bank, dx, dy):
        return sum(float((bank @ _shifted(st, dx, dy).reshape(-1)).max()) for st in stacks)

    best = (-1, None)
    for font in FONTS:
        for size in np.arange(0.22, 0.64, 0.03):
            for blur in (1.0, 1.6, 2.4, 3.2):
                bank = _bank(font, size, blur).reshape(len(ALL), -1)
                for dx in range(-8, 9, 2):
                    for dy in range(-8, 9, 2):
                        s = total(bank, dx, dy)
                        if s > best[0]:
                            best = (s, (font, float(size), blur, dx, dy))
    font, size, blur, dx, dy = best[1]
    for sz in np.arange(size - 0.02, size + 0.021, 0.01):  # second pass, fine steps around the winner
        for bl in (blur - 0.3, blur, blur + 0.3):
            bank = _bank(font, sz, bl).reshape(len(ALL), -1)
            for ex in (-1, 0, 1):
                for ey in (-1, 0, 1):
                    s = total(bank, dx + ex, dy + ey)
                    if s > best[0]:
                        best = (s, (font, float(sz), bl, dx + ex, dy + ey))
    return best[1], best[0] / len(stacks)


def make_reader(params):
    font, size, blur, dx, dy = params
    bank = _bank(font, size, blur).reshape(len(ALL), -1)

    def read(stack, allow=None):
        """-> (code, score, runner_up_code, runner_up_score); small extra shifts absorb jitter"""
        best = np.full(len(ALL), -1.0)
        for ex in (-1, 0, 1):
            for ey in (-1, 0, 1):
                best = np.maximum(best, bank @ _shifted(stack, dx + ex, dy + ey).reshape(-1))
        if allow is not None:
            mask = np.array([c in allow for c in ALL])
            best = np.where(mask, best, -1)
        o = np.argsort(-best)
        return ALL[o[0]], float(best[o[0]]), ALL[o[1]], float(best[o[1]])

    def all_scores(stack):
        best = np.full(len(ALL), -1.0)
        for ex in (-1, 0, 1):
            for ey in (-1, 0, 1):
                best = np.maximum(best, bank @ _shifted(stack, dx + ex, dy + ey).reshape(-1))
        return best

    read.all = all_scores
    return read
