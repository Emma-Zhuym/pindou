"""Grid and board geometry of a sample, cached (finding the grid is the slow part)."""
import json
from pathlib import Path

from engine import find_board, find_grid, load

HERE = Path(__file__).resolve().parent


def geometry(key, file):
    path = HERE / 'out' / f'{key}.geo.json'
    if path.exists():
        return json.load(open(path))
    im, a = load(file)
    grid = find_grid(a)
    r0, c0, nr, nc = find_board(a, grid)
    H, W = a.shape[:2]
    # keep whole cells that lie inside the image
    while grid[3] + r0 * grid[2] < -0.5: r0, nr = r0 + 1, nr - 1
    while grid[1] + c0 * grid[0] < -0.5: c0, nc = c0 + 1, nc - 1
    while grid[3] + (r0 + nr) * grid[2] > H + 0.5: nr -= 1
    while grid[1] + (c0 + nc) * grid[0] > W + 0.5: nc -= 1
    geo = dict(grid=[float(v) for v in grid], r0=r0, c0=c0, nr=nr, nc=nc)
    json.dump(geo, open(path, 'w'))
    return geo
