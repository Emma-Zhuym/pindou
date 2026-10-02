"""Contact sheet of the stacked label of each colour group (debug view)."""
import sys
import numpy as np
from PIL import Image
from engine import greedy, INK
key, thr = sys.argv[1], float(sys.argv[2])
z = np.load(f'out/{key}.npz'); F = z['fill'].reshape(-1, 3); K = z['ink'].reshape(-1, INK, INK)
cents, counts, lab = greedy(F, thr)
order = np.argsort(-counts)[:40]
Z = 4; per = 10
sheet = Image.new('RGB', (per * (INK * Z + 6), ((len(order) + per - 1) // per) * (INK * Z + 6)), 'white')
for i, j in enumerate(order):
    m = K[lab == j].mean(axis=0); m = (m - m.min()) / (m.max() - m.min() + 1e-6)
    sheet.paste(Image.fromarray((255 - m * 255).astype(np.uint8)).resize((INK * Z, INK * Z), Image.BICUBIC), ((i % per) * (INK * Z + 6), (i // per) * (INK * Z + 6)))
sheet.save(f'out/montage_{key}.png'); print(len(cents), 'groups;', ' '.join(str(counts[j]) for j in order))
