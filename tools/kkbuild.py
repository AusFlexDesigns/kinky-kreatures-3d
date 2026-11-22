"""Turn one mould model (OBJ/STL/FBX and other formats Assimp reads; Y up) into the web files for the 3D viewer.

    python kkbuild.py <model.obj|stl> <out_dir> <id> [--color #7A48E8] [--display 4000] [--ar 12000] [--no-ar]

Writes into <out_dir>:
  <id>.kkm      scrambled display model: low-detail mesh + object-space normal map baked from the full model
  <id>-ar.glb   AR model for phones: medium-detail mesh + tangent-space normal map, Draco-compressed
and prints a JSON line with the model's real size (for manifest.json).
The mould file itself never leaves your machine/workspace; only these two outputs go in the public repo.
"""
import sys, os, io, json, struct, subprocess, tempfile, argparse
import numpy as np, trimesh, xatlas, pyfqmr
from scipy.spatial import cKDTree
from scipy import ndimage
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GT = ['npx', '--prefix', os.path.join(HERE, '..'), 'gltf-transform']


# ---------- loading ----------
def load_obj_fast(path):
    """Large OBJ (millions of faces, quads or triangles, v//vn style) without Python-per-line parsing."""
    v = subprocess.run(['bash', '-c', 'grep "^v " "$0" | cut -c3-', path], capture_output=True, check=True).stdout
    verts = np.fromstring(v, sep=' ', dtype=np.float64).reshape(-1, 3); del v
    awk = r'''grep "^f " "$0" | sed -e 's#/[^ ]*##g' -e 's/^f //' | awk '{print $1,$2,$3; if (NF==4) print $1,$3,$4}' '''
    f = subprocess.run(['bash', '-c', awk, path], capture_output=True, check=True).stdout
    faces = np.fromstring(f, sep=' ', dtype=np.int64).reshape(-1, 3) - 1; del f
    return verts, faces


ASSIMP_EXT = ('.fbx', '.dae', '.3ds', '.blend', '.gltf', '.glb', '.3mf', '.x3d', '.ply')


def via_assimp(path):
    """FBX and friends: flatten every mesh into world space (node transforms applied) as a temporary OBJ."""
    tmp = tempfile.mkdtemp()
    out = os.path.join(tmp, 'flat.obj')
    r = subprocess.run(['assimp', 'export', path, out, '-ptv', '-tri', '-jiv'], capture_output=True, text=True)
    if r.returncode or not os.path.exists(out):
        raise SystemExit(f'assimp could not read {path}: {r.stderr.strip() or r.stdout.strip()[-300:]}')
    info = subprocess.run(['assimp', 'info', path], capture_output=True, text=True).stdout
    meshes = [l.split()[-1] for l in info.splitlines() if l.strip().startswith('Meshes:') and l.split()[-1].isdigit()]
    print(json.dumps({"source_meshes": int(meshes[0]) if meshes else None}), file=sys.stderr)   # more than 1: check nothing extra is in the file
    return out


def to_mm(v, units):
    """Scale to millimetres. 'auto' judges by size: a toy is 60-600 mm long."""
    longest = float((v.max(0) - v.min(0)).max())
    if units == 'auto':
        units = 'm' if longest < 1.5 else 'cm' if longest < 60 else 'mm'
    k = {'mm': 1, 'cm': 10, 'm': 1000, 'in': 25.4}[units]
    print(json.dumps({"units": units, "longest_mm": round(longest * k, 1)}), file=sys.stderr)
    return v * k


def load_mesh(path, upright=False, units='auto'):
    if path.lower().endswith(ASSIMP_EXT):
        v, f = load_obj_fast(via_assimp(path))
    elif path.lower().endswith('.obj'):
        v, f = load_obj_fast(path)
    else:
        m = trimesh.load(path, force='mesh', process=False); v, f = np.asarray(m.vertices, np.float64), np.asarray(m.faces)
    v = to_mm(v, units)
    m = trimesh.Trimesh(v, f, process=True)           # merges duplicate vertices so decimation keeps a closed surface
    v = np.asarray(m.vertices)
    if upright:                                       # stand the longest dimension up (cans exported lying down)
        ax = int(np.argmax(v.max(0) - v.min(0)))
        if ax == 2: v = np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)     # rotate, don't mirror, so faces keep their winding
        elif ax == 0: v = np.stack([-v[:, 1], v[:, 0], v[:, 2]], 1)
    c = (v.min(0) + v.max(0)) / 2
    v = (v - [c[0], v[:, 1].min(), c[2]]) * 0.001     # stand on the ground, centred, mm -> metres
    return v, np.asarray(m.faces)


def simplify(v, f, target, aggressiveness=5):
    if len(f) <= target: return trimesh.Trimesh(v, f, process=True)
    if len(f) > 3000000:
        # pyfqmr falls apart on ~10M-triangle sculpts; take them down to ~1.5M with VTK's quadric decimator first
        import fast_simplification
        v, f = fast_simplification.simplify(np.asarray(v, np.float32), np.asarray(f, np.int32), target_count=1500000)
        v = np.asarray(v, np.float64); f = np.asarray(f, np.int64)
    s = pyfqmr.Simplify(); s.setMesh(v, f)
    s.simplify_mesh(target_count=target, aggressiveness=aggressiveness, preserve_border=True, verbose=False)
    lv, lf, _ = s.getMesh()
    if len(lf) > target * 1.3:
        import fast_simplification
        lv, lf = fast_simplification.simplify(np.asarray(v, np.float32), np.asarray(f, np.int32), target_count=target)
    return trimesh.Trimesh(np.asarray(lv, np.float64), np.asarray(lf), process=True)


def voxel_solid(mesh, pitch):
    """One closed surface from overlapping or not-quite-closed pieces (working sculpts, CAD exports):
    mark the voxels the surface passes through, close small gaps, fill the inside, re-mesh the outside."""
    from skimage.measure import marching_cubes
    n = int(mesh.area / (pitch * 0.5) ** 2)
    pts, _ = trimesh.sample.sample_surface(mesh, min(n, 6000000), seed=2)
    pts = np.vstack([pts, mesh.vertices])
    origin = mesh.bounds[0] - 4 * pitch
    shape = np.ceil((mesh.bounds[1] - mesh.bounds[0]) / pitch).astype(int) + 9
    vox = np.zeros(shape, bool); ijk = np.floor((pts - origin) / pitch).astype(int); del pts
    vox[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True; del ijk
    vox = ndimage.binary_closing(vox, iterations=1)
    vox = ndimage.binary_fill_holes(vox)
    f = ndimage.gaussian_filter(vox.astype(np.float32), 0.8); del vox
    verts, faces, _, _ = marching_cubes(f, 0.5)
    out = trimesh.Trimesh(verts * pitch + origin, faces[:, ::-1], process=True)
    if out.volume < 0: out.invert()
    parts = out.split(only_watertight=False)
    return max(parts, key=lambda p: p.area) if len(parts) > 1 else out


# ---------- glTF ----------
def write_glb(path, attrs, idx, image=None, color=(0.478, 0.282, 0.910, 1.0)):
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
    ib = np.ascontiguousarray(np.asarray(idx).ravel(), dtype='<u4')
    accs.append({"bufferView": add(ib, 34963), "componentType": 5125, "count": len(ib), "type": "SCALAR"})
    mat = {"name": "Silicone", "pbrMetallicRoughness": {"baseColorFactor": list(color), "metallicFactor": 0.0, "roughnessFactor": 0.42}}
    gltf = {"asset": {"version": "2.0", "generator": "kkbuild"}, "scene": 0, "scenes": [{"nodes": [0]}],
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


# ---------- baking ----------
class Detail:
    """Dense samples of the full model's smooth normals, for nearest-surface lookups."""
    def __init__(self, mesh, samples=2500000):
        pts, fid = trimesh.sample.sample_surface(mesh, samples, seed=1)
        bary = trimesh.triangles.points_to_barycentric(mesh.triangles[fid], pts)
        hn = (np.asarray(mesh.vertex_normals)[mesh.faces[fid]] * bary[:, :, None]).sum(1)
        self.n = hn / np.linalg.norm(hn, axis=1, keepdims=True); self.tree = cKDTree(pts)


def bake(detail, P, N, UV, tri, res, T=None):
    """Rasterise the low mesh in UV space; per texel take the full model's normal. Object space, or tangent space if T given."""
    W = H = res
    tp = np.zeros((H, W, 3), np.float32); tn = np.zeros((H, W, 3), np.float32); mask = np.zeros((H, W), bool)
    tt = np.zeros((H, W, 4), np.float32) if T is not None else None
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
        tp[yy + y0, xx + x0] = ww @ P[t]; tn[yy + y0, xx + x0] = ww @ N[t]; mask[yy + y0, xx + x0] = True
        if T is not None: tt[yy + y0, xx + x0] = ww @ T[t]
    q = tp[mask]; qn = tn[mask]; qn /= np.linalg.norm(qn, axis=1, keepdims=True) + 1e-9
    d, nn = detail.tree.query(q, k=6, workers=-1)
    cand = detail.n[nn]; agree = np.clip((cand * qn[:, None, :]).sum(2), 0, 1) + 1e-3
    wgt = agree / (d + 2e-4) ** 2; o = (cand * wgt[:, :, None]).sum(1); o /= np.linalg.norm(o, axis=1, keepdims=True) + 1e-9
    img = np.zeros((H, W, 3), np.float32)
    if T is not None:
        qt = tt[mask][:, :3]; sign = np.where(tt[mask][:, 3] < 0, -1.0, 1.0)
        qt = qt - qn * (qt * qn).sum(1, keepdims=True); qt /= np.linalg.norm(qt, axis=1, keepdims=True) + 1e-9
        qb = np.cross(qn, qt) * sign[:, None]
        o = np.stack([(o * qt).sum(1), (o * qb).sum(1), (o * qn).sum(1)], 1); img[..., 2] = 1
    img[mask] = o
    _, ind = ndimage.distance_transform_edt(~mask, return_indices=True); img = img[ind[0], ind[1]]
    return (np.clip(img * 0.5 + 0.5, 0, 1) * 255).round().astype(np.uint8), float(d[:, 0].mean())


def unwrap(mesh, res, padding):
    atlas = xatlas.Atlas(); atlas.add_mesh(np.asarray(mesh.vertices, np.float32), np.asarray(mesh.faces, np.uint32))
    po = xatlas.PackOptions(); po.resolution = res; po.padding = padding; po.bilinear = True
    atlas.generate(pack_options=po); vmap, idx, uv = atlas[0]
    return np.asarray(mesh.vertices)[vmap], np.asarray(mesh.vertex_normals)[vmap], uv, idx


# ---------- outputs ----------
def keystream(n, seed):
    out = np.empty(n, np.uint8); a = seed & 0xFFFFFFFF
    for i in range(n):
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF; t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        out[i] = ((t ^ (t >> 14)) & 0xFFFFFFFF) & 0xFF
    return out


def pack_kkm(pos, uv, idx, tex):
    idx = np.asarray(idx).ravel(); assert len(pos) < 65536
    bmin = pos.min(0); bsize = pos.max(0) - bmin
    qp = np.round((pos - bmin) / bsize * 65535).astype('<u2'); quv = np.round(np.clip(uv, 0, 1) * 65535).astype('<u2'); qi = idx.astype('<u2')
    pad = lambda b: b + b'\0' * (-len(b) % 4)
    body = struct.pack('<4sIII3f3f', b'KKM1', len(pos), len(idx) // 3, len(tex), *bmin.tolist(), *bsize.tolist()) + pad(qp.tobytes()) + pad(quv.tobytes()) + pad(qi.tobytes()) + tex
    seed = (0x4B4B5231 ^ (len(body) * 2654435761)) & 0xFFFFFFFF
    return (np.frombuffer(body, np.uint8) ^ keystream(len(body), seed)).tobytes()[::-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out_dir'); ap.add_argument('id')
    ap.add_argument('--display', type=int, default=4000); ap.add_argument('--display-res', type=int, default=1024)
    ap.add_argument('--ar', type=int, default=12000); ap.add_argument('--ar-res', type=int, default=2048)
    ap.add_argument('--no-ar', action='store_true'); ap.add_argument('--upright', action='store_true'); ap.add_argument('--units', default='auto', choices=['auto', 'mm', 'cm', 'm', 'in']); ap.add_argument('--voxel', type=float, default=0, help='rebuild the surface from voxels of this size in mm (CAD exports that will not decimate)'); ap.add_argument('--color', default='#7A48E8')
    a = ap.parse_args()
    col = [int(a.color[i:i + 2], 16) / 255 for i in (1, 3, 5)]; col = [c ** 2.2 for c in col] + [1.0]   # sRGB -> linear for glTF
    os.makedirs(a.out_dir, exist_ok=True)
    v, f = load_mesh(a.src, a.upright, a.units)
    full = len(f)
    high = simplify(v, f, 600000, aggressiveness=7); del v, f            # still far finer than the bake resolution
    detail = Detail(high)
    ext = high.extents
    base = high
    if a.voxel:
        base = voxel_solid(high, a.voxel / 1000)
    # display model (.kkm)
    low = simplify(np.asarray(base.vertices), np.asarray(base.faces), a.display, 4)
    P, N, UV, idx = unwrap(low, a.display_res, 6)
    img, dd = bake(detail, P, N, UV, idx, a.display_res)
    buf = io.BytesIO(); Image.fromarray(img).save(buf, 'WEBP', quality=92, method=6)
    kkm = pack_kkm(P.astype(np.float32), UV.astype(np.float32), idx, buf.getvalue())
    open(os.path.join(a.out_dir, a.id + '.kkm'), 'wb').write(kkm)
    info = {"id": a.id, "full_tris": int(full), "display_tris": int(len(idx)), "kkm_kb": len(kkm) // 1024,
            "length_cm": round(float(ext[1]) * 100, 1), "widest_cm": round(float(max(ext[0], ext[2])) * 100, 1)}
    # AR model (.glb)
    if not a.no_ar:
        tmp = tempfile.mkdtemp()
        arm = simplify(np.asarray(base.vertices), np.asarray(base.faces), a.ar, 4)
        P, N, UV, idx = unwrap(arm, a.ar_res, 8)
        write_glb(f'{tmp}/uv.glb', [('POSITION', P), ('NORMAL', N), ('TEXCOORD_0', UV)], idx, color=col)
        subprocess.run(GT + ['tangents', f'{tmp}/uv.glb', f'{tmp}/tan.glb'], check=True, capture_output=True)
        A, idx = read_glb(f'{tmp}/tan.glb')
        img, _ = bake(detail, A['POSITION'], A['NORMAL'], A['TEXCOORD_0'], idx.reshape(-1, 3), a.ar_res, A['TANGENT'])
        buf = io.BytesIO(); Image.fromarray(img).save(buf, 'JPEG', quality=90, subsampling=0)
        write_glb(f'{tmp}/ar.glb', [('POSITION', A['POSITION']), ('NORMAL', A['NORMAL']), ('TANGENT', A['TANGENT']),
                                    ('TEXCOORD_0', A['TEXCOORD_0'])], idx, buf.getvalue(), color=col)
        out = os.path.join(a.out_dir, a.id + '-ar.glb')
        subprocess.run(GT + ['draco', f'{tmp}/ar.glb', out], check=True, capture_output=True)
        info.update(ar_tris=int(len(idx) // 3), ar_kb=os.path.getsize(out) // 1024)
    print(json.dumps(info))


if __name__ == '__main__':
    main()
