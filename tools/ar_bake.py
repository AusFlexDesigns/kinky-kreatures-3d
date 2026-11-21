"""Build the AR model: a medium-detail mesh plus a tangent-space normal map baked from the full model.

Usage: python ar_bake.py <full.glb> <out.glb> [triangles=20000] [texture=2048]
<full.glb> is the full-detail model in metres (convert.py's *_high_raw.glb). Needs the gltf-transform CLI
(npx) for MikkTSpace tangents and Draco compression, so phones get exactly the tangents the bake used.
"""
import sys, os, json, struct, subprocess, tempfile, io, numpy as np, trimesh, xatlas, pyfqmr
from scipy.spatial import cKDTree
from scipy import ndimage
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
TARGET = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
RES = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
COLOR = [0.478, 0.282, 0.910, 1.0]
GT = ['npx', '--prefix', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'), 'gltf-transform']


def write_glb(path, attrs, idx, image=None):
    """attrs: list of (name, float32 array [n, k]). image: JPEG bytes used as the normal map."""
    chunks, views, accs, attr_map = [], [], [], {}
    off = 0
    def add(data, target=None):
        nonlocal off
        b = data.tobytes(); pad = -len(b) % 4
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), **({"target": target} if target else {})})
        chunks.append(b + b'\0' * pad); off += len(b) + pad
        return len(views) - 1
    for name, arr in attrs:
        arr = np.ascontiguousarray(arr, dtype='<f4')
        acc = {"bufferView": add(arr, 34962), "componentType": 5126, "count": len(arr), "type": {2: "VEC2", 3: "VEC3", 4: "VEC4"}[arr.shape[1]]}
        if name == 'POSITION': acc.update(min=arr.min(0).tolist(), max=arr.max(0).tolist())
        accs.append(acc); attr_map[name] = len(accs) - 1
    ib = np.ascontiguousarray(idx.ravel(), dtype='<u4')
    accs.append({"bufferView": add(ib, 34963), "componentType": 5125, "count": len(ib), "type": "SCALAR"})
    mat = {"name": "Silicone", "pbrMetallicRoughness": {"baseColorFactor": COLOR, "metallicFactor": 0.0, "roughnessFactor": 0.42}}
    gltf = {"asset": {"version": "2.0", "generator": "kk-ar-bake"}, "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": attr_map, "indices": len(accs) - 1, "material": 0}]}],
            "materials": [mat], "bufferViews": views, "accessors": accs}
    if image is not None:
        gltf["images"] = [{"bufferView": add(np.frombuffer(image, np.uint8)), "mimeType": "image/jpeg"}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]
        gltf["textures"] = [{"source": 0, "sampler": 0}]
        mat["normalTexture"] = {"index": 0}
    bin_ = b''.join(chunks); gltf["buffers"] = [{"byteLength": len(bin_)}]
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_)))
        fh.write(struct.pack('<I4s', len(js), b'JSON')); fh.write(js)
        fh.write(struct.pack('<I4s', len(bin_), b'BIN\0')); fh.write(bin_)


def read_glb(path):
    data = open(path, 'rb').read()
    jl = struct.unpack_from('<I', data, 12)[0]; g = json.loads(data[20:20 + jl]); b0 = 20 + jl + 8
    def acc(i):
        a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a['type']]
        dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]
        isz = np.dtype(dt).itemsize; stride = v.get('byteStride', n * isz)
        start = b0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        raw = np.frombuffer(data, np.uint8, count=stride * (a['count'] - 1) + n * isz, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, (a['count'], n * isz), (stride, 1))
        return np.frombuffer(rows.copy().tobytes(), dt).reshape(a['count'], n)
    p = g['meshes'][0]['primitives'][0]
    return {k: acc(i) for k, i in p['attributes'].items()}, acc(p['indices']).ravel()


# 1. medium-detail mesh with UVs
src = trimesh.load(SRC, force='mesh')
s = pyfqmr.Simplify(); s.setMesh(np.asarray(src.vertices, np.float64), np.asarray(src.faces))
s.simplify_mesh(target_count=TARGET, aggressiveness=4, preserve_border=True, verbose=False)
lv, lf, _ = s.getMesh(); low = trimesh.Trimesh(lv, lf, process=True)
atlas = xatlas.Atlas(); atlas.add_mesh(np.asarray(low.vertices, np.float32), np.asarray(low.faces, np.uint32))
po = xatlas.PackOptions(); po.resolution = RES; po.padding = 8; po.bilinear = True
atlas.generate(pack_options=po); vmap, idx, uv = atlas[0]

# 2. MikkTSpace tangents from gltf-transform, read back so the bake matches what phones compute
tmp = tempfile.mkdtemp()
write_glb(f'{tmp}/uv.glb', [('POSITION', np.asarray(low.vertices)[vmap]), ('NORMAL', np.asarray(low.vertex_normals)[vmap]),
                            ('TEXCOORD_0', uv)], idx)
subprocess.run(GT + ['tangents', f'{tmp}/uv.glb', f'{tmp}/tan.glb'], check=True, capture_output=True)
A, idx = read_glb(f'{tmp}/tan.glb')
P, N, T, UV = A['POSITION'], A['NORMAL'], A['TANGENT'], A['TEXCOORD_0']
tri = idx.reshape(-1, 3)
print('AR mesh', len(tri), 'triangles,', len(P), 'vertices, watertight', low.is_watertight)

# 3. full-detail normals, sampled densely
pts, fid = trimesh.sample.sample_surface(src, 2500000, seed=1)
bary = trimesh.triangles.points_to_barycentric(src.triangles[fid], pts)
hn = (np.asarray(src.vertex_normals)[src.faces[fid]] * bary[:, :, None]).sum(1); hn /= np.linalg.norm(hn, axis=1, keepdims=True)
tree = cKDTree(pts)

# 4. rasterise in UV space (glTF UV origin is top-left, so v maps straight to image rows)
W = H = RES
tp = np.zeros((H, W, 3), np.float32); tn = np.zeros((H, W, 3), np.float32); tt = np.zeros((H, W, 4), np.float32); mask = np.zeros((H, W), bool)
uvp = UV * [W, H]
for t in tri:
    a, b, c = uvp[t]
    x0, x1 = max(int(min(a[0], b[0], c[0])) - 1, 0), min(int(max(a[0], b[0], c[0])) + 2, W - 1)
    y0, y1 = max(int(min(a[1], b[1], c[1])) - 1, 0), min(int(max(a[1], b[1], c[1])) + 2, H - 1)
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den; w2 = 1 - w0 - w1
    inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
    if not inside.any(): continue
    yy, xx = np.nonzero(inside); ww = np.stack([w0[inside], w1[inside], w2[inside]], 1)
    tp[yy + y0, xx + x0] = ww @ P[t]; tn[yy + y0, xx + x0] = ww @ N[t]; tt[yy + y0, xx + x0] = ww @ T[t]; mask[yy + y0, xx + x0] = True

q = tp[mask]; qn = tn[mask]; qn /= np.linalg.norm(qn, axis=1, keepdims=True) + 1e-9
qt = tt[mask][:, :3]; sign = np.where(tt[mask][:, 3] < 0, -1.0, 1.0)
qt = qt - qn * (qt * qn).sum(1, keepdims=True); qt /= np.linalg.norm(qt, axis=1, keepdims=True) + 1e-9
qb = np.cross(qn, qt) * sign[:, None]
d, nn = tree.query(q, k=6, workers=-1)
cand = hn[nn]; agree = np.clip((cand * qn[:, None, :]).sum(2), 0, 1) + 1e-3
wgt = agree / (d + 2e-4) ** 2; o = (cand * wgt[:, :, None]).sum(1); o /= np.linalg.norm(o, axis=1, keepdims=True) + 1e-9
ts = np.stack([(o * qt).sum(1), (o * qb).sum(1), (o * qn).sum(1)], 1)
img = np.zeros((H, W, 3), np.float32); img[..., 2] = 1; img[mask] = ts
_, ind = ndimage.distance_transform_edt(~mask, return_indices=True); img = img[ind[0], ind[1]]
rgb = (np.clip(img * 0.5 + 0.5, 0, 1) * 255).round().astype(np.uint8)
buf = io.BytesIO(); Image.fromarray(rgb).save(buf, 'JPEG', quality=90, subsampling=0); jpg = buf.getvalue()

# 5. final GLB, Draco-compressed geometry
write_glb(f'{tmp}/ar.glb', [('POSITION', P), ('NORMAL', N), ('TANGENT', T), ('TEXCOORD_0', UV)], idx, jpg)
subprocess.run(GT + ['draco', f'{tmp}/ar.glb', OUT], check=True, capture_output=True)
nodraco = OUT.replace('.glb', '.nodraco.glb') if '--keep' in sys.argv else None
if nodraco: os.replace(f'{tmp}/ar.glb', nodraco)
print('normal map', RES, 'px,', len(jpg) // 1024, 'KB; AR file', os.path.getsize(OUT) // 1024, 'KB; mean bake distance',
      round(float(d[:, 0].mean() * 1000), 3), 'mm')
