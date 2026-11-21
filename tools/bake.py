"""Bake the full model's surface detail into an object-space normal map for a low-detail mesh."""
import sys, json, numpy as np, trimesh, xatlas, pyfqmr
from scipy.spatial import cKDTree
from scipy import ndimage
from PIL import Image
target, RES = int(sys.argv[1]), int(sys.argv[2])
src = trimesh.load('kraken_large_high_raw.glb', force='mesh')
v = np.asarray(src.vertices, dtype=np.float64); f = np.asarray(src.faces)
s = pyfqmr.Simplify(); s.setMesh(v, f); s.simplify_mesh(target_count=target, aggressiveness=4, preserve_border=True, verbose=False)
lv, lf, _ = s.getMesh(); low = trimesh.Trimesh(lv, lf, process=True)
print('low faces', len(low.faces), 'watertight', low.is_watertight)
# UV unwrap
atlas = xatlas.Atlas(); atlas.add_mesh(np.asarray(low.vertices, dtype=np.float32), np.asarray(low.faces, dtype=np.uint32))
po = xatlas.PackOptions(); po.resolution = RES; po.padding = 6; po.bilinear = True
atlas.generate(pack_options=po); vmap, idx, uv = atlas[0]
P = np.asarray(low.vertices)[vmap]; N = np.asarray(low.vertex_normals)[vmap]; print('uv verts', len(P), 'atlas', atlas.width, atlas.height)
W = H = RES
# dense samples of the full model with smooth normals
pts, fid = trimesh.sample.sample_surface(src, 2500000, seed=1)
bary = trimesh.triangles.points_to_barycentric(src.triangles[fid], pts)
hn = (np.asarray(src.vertex_normals)[src.faces[fid]] * bary[:, :, None]).sum(1); hn /= np.linalg.norm(hn, axis=1, keepdims=True)
tree = cKDTree(pts)
# rasterise every low triangle in UV space
tex_pos = np.zeros((H, W, 3), np.float32); tex_nrm = np.zeros((H, W, 3), np.float32); mask = np.zeros((H, W), bool)
uvp = uv * [W, H]
for tri in idx:
    a, b, c = uvp[tri]; x0, x1 = int(np.floor(min(a[0], b[0], c[0]))), int(np.ceil(max(a[0], b[0], c[0]))); y0, y1 = int(np.floor(min(a[1], b[1], c[1]))), int(np.ceil(max(a[1], b[1], c[1])))
    x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, W - 1), min(y1 + 1, H - 1)
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den; w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den; w2 = 1 - w0 - w1
    inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
    if not inside.any(): continue
    yy, xx = np.nonzero(inside); ww = np.stack([w0[inside], w1[inside], w2[inside]], 1)
    tex_pos[yy + y0, xx + x0] = ww @ P[tri]; tex_nrm[yy + y0, xx + x0] = ww @ N[tri]; mask[yy + y0, xx + x0] = True
q = tex_pos[mask]; qn = tex_nrm[mask]; qn /= np.linalg.norm(qn, axis=1, keepdims=True) + 1e-9
d, nn = tree.query(q, k=6, workers=-1)
cand = hn[nn]; agree = np.clip((cand * qn[:, None, :]).sum(2), 0, 1) + 1e-3
wgt = agree / (d + 2e-4) ** 2; out = (cand * wgt[:, :, None]).sum(1); out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
img = np.zeros((H, W, 3), np.float32); img[mask] = out
# pad islands so filtering never picks up empty texels
_, ind = ndimage.distance_transform_edt(~mask, return_indices=True); img = img[ind[0], ind[1]]
png = (np.clip(img * 0.5 + 0.5, 0, 1) * 255).round().astype(np.uint8)
Image.fromarray(png).save(f'nrm_{target}.webp', quality=92, method=6); Image.fromarray(png).save(f'nrm_{target}.png')
np.savez(f'low_{target}.npz', pos=P.astype(np.float32), uv=uv.astype(np.float32), idx=idx.astype(np.uint32), nrm=N.astype(np.float32))
import os; print('texels', int(mask.sum()), 'coverage', round(float(mask.mean()), 2), 'webp KB', os.path.getsize(f'nrm_{target}.webp') // 1024, 'png KB', os.path.getsize(f'nrm_{target}.png') // 1024, 'mean query dist mm', round(float(d[:, 0].mean() * 1000), 2))
