"""Merge a working sculpt (many overlapping pieces: body, suckers, base...) into one closed solid, like a
mould-ready export. Run this first when kkbuild.py's output looks shattered or spiky.

    python solidify.py <model.obj|stl|ply> <solid.ply> [voxel_mm=0.3]

Keeps only the outside surface: pieces buried inside the body disappear. Detail finer than the voxel
size is smoothed, so 0.3 mm keeps sucker rims and texture well. Output stays in the input's units (mm).
"""
import sys, gc, numpy as np, trimesh
from scipy import ndimage
from skimage.measure import marching_cubes

src, out = sys.argv[1], sys.argv[2]
pitch = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3

if src.lower().endswith('.obj'):
    sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
    from kkbuild import load_obj_fast
    v, f = load_obj_fast(src)
elif src.lower().endswith('.stl'):
    sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
    from preshrink import load_merged   # merge shared corners first: simplifying an unmerged STL leaves holes
    v, f = load_merged(src)
else:
    m = trimesh.load(src, force='mesh', process=True); v, f = np.asarray(m.vertices), np.asarray(m.faces); del m
if len(f) > 3000000:
    import fast_simplification
    v, f = fast_simplification.simplify(np.asarray(v, np.float32), np.asarray(f, np.int32), target_count=1500000)
gc.collect()
mesh = trimesh.Trimesh(np.asarray(v, np.float64), np.asarray(f), process=False); del v, f

# keep the voxel grid within memory (about 30 million cells): big toys get a slightly coarser voxel
ext = mesh.bounds[1] - mesh.bounds[0] + 7 * pitch
need = (np.prod(ext) / 30e6) ** (1 / 3)
if need > pitch: print('  voxel', round(pitch, 2), '->', round(need, 2), 'mm to fit memory'); pitch = need

# 1. voxels the surface passes through (dense surface samples, half a voxel apart)
lo = mesh.bounds[0] - 3 * pitch
shape = np.ceil((mesh.bounds[1] - mesh.bounds[0]) / pitch).astype(int) + 7
vox = np.zeros(shape, bool)
n_total = int(mesh.area / (pitch * 0.5) ** 2)
for chunk in range(0, n_total, 3000000):
    pts, _ = trimesh.sample.sample_surface(mesh, min(3000000, n_total - chunk), seed=chunk)
    ijk = np.floor((pts - lo) / pitch).astype(np.int32); vox[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    del pts, ijk
ijk = np.floor((mesh.vertices - lo) / pitch).astype(np.int32); vox[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
del mesh, ijk; gc.collect()

# 2. everything the outside air can't reach is solid. Sculpts often have small holes, so the air is flooded
#    in past walls thickened by k voxels (plugging holes up to ~2k voxels), then grown back to the real surface.
def flood_outside(walls):
    lab, _ = ndimage.label(~walls)
    edge = np.unique(np.concatenate([lab[0].ravel(), lab[-1].ravel(), lab[:, 0].ravel(), lab[:, -1].ravel(), lab[:, :, 0].ravel(), lab[:, :, -1].ravel()]))
    return np.isin(lab, edge[edge > 0])
shell = int(vox.sum())
for k in (0, 2, 4, 7):
    air = flood_outside(ndimage.binary_dilation(vox, iterations=k) if k else vox)
    if k: air = ndimage.binary_dilation(air, iterations=k) & ~vox
    solid = ~air; del air
    fill = int(solid.sum()) / shell
    print('  hole plug', k, 'voxels: solid/shell', round(fill, 1))
    if fill > 4: break
del vox; gc.collect()

# 3. smooth the voxel steps and re-mesh the outside
fld = ndimage.gaussian_filter(solid.astype(np.float32), 0.9); del solid; gc.collect()
verts, faces, _, _ = marching_cubes(fld, 0.5); del fld; gc.collect()
solid = trimesh.Trimesh(verts * pitch + lo, faces, process=True)
if solid.volume < 0: solid.invert()
parts = solid.split(only_watertight=False)
if len(parts) > 1:   # drop specks, keep every real piece (a base that only touches the body stays)
    big = max(p.area for p in parts)
    for p in parts: print('  piece', len(p.faces), 'tris, size mm', p.extents.round(1).tolist(), 'centre', p.bounds.mean(0).round(1).tolist())
    solid = trimesh.util.concatenate([p for p in parts if p.area > big * 0.05])
solid.export(out)
print('solid', len(solid.faces), 'triangles, watertight', solid.is_watertight, 'size mm', solid.extents.round(1).tolist())
