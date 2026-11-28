"""Shrink a very large binary STL (millions of triangles) to a manageable working copy before kkbuild/solidify,
using as little memory as possible (reads the triangle records straight from disk).

    python preshrink.py <big.stl> <small.stl> [target_tris=1500000]

The full-resolution mould files stay untouched; this copy is only for building the web viewer models.
"""
import sys, gc, numpy as np, fast_simplification

rec = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])


def load_merged(src):
    """Binary STL -> (vertices, faces) with shared corners merged, so the mesh is connected (a raw STL is a
    'soup' of separate triangles, and simplifying a soup just deletes triangles and leaves holes)."""
    n = int(np.fromfile(src, '<u4', count=1, offset=80)[0])
    tri = np.memmap(src, rec, 'r', offset=84, shape=(n,))['v']
    pts = np.ascontiguousarray(tri.reshape(-1, 3)); del tri
    # merge identical corners: quantise to 1 µm and dedupe
    q = np.round(pts / 0.001).astype(np.int64)
    key = (q[:, 0] - q[:, 0].min()) * 1_000_003 ** 2 + (q[:, 1] - q[:, 1].min()) * 1_000_003 + (q[:, 2] - q[:, 2].min())
    del q; gc.collect()
    uk, first, inv = np.unique(key, return_index=True, return_inverse=True); del key, uk; gc.collect()
    v = pts[first].astype(np.float32); del pts, first; gc.collect()
    f = inv.reshape(-1, 3).astype(np.int32); del inv; gc.collect()
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    print('loaded', n, 'triangles,', len(v), 'vertices', flush=True)
    return v, f


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    target = int(sys.argv[3]) if len(sys.argv) > 3 else 1500000
    v, f = load_merged(src)
    if len(f) > target:
        v, f = fast_simplification.simplify(v, f, target_count=target)
    print('shrunk to', len(f), 'triangles', flush=True)

    # write binary STL
    tv = v[f].astype('<f4')
    nrm = np.cross(tv[:, 1] - tv[:, 0], tv[:, 2] - tv[:, 0]); ln = np.linalg.norm(nrm, axis=1, keepdims=True); nrm /= np.where(ln == 0, 1, ln)
    outrec = np.zeros(len(f), rec); outrec['n'] = nrm; outrec['v'] = tv
    with open(out, 'wb') as fh:
        fh.write(b'preshrink'.ljust(80, b' ')); fh.write(np.uint32(len(f)).tobytes()); outrec.tofile(fh)
