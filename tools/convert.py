"""OBJ/STL (millimetres, Y up) -> web GLBs in metres at several quality levels."""
import sys, json, struct, numpy as np, trimesh, fast_simplification
src, name = sys.argv[1], sys.argv[2]
COLOR = [0.478, 0.282, 0.910, 1.0]   # brand purple, single-colour display material

def write_glb(path, v, n, f):
    v = v.astype('<f4'); n = n.astype('<f4'); idx = f.astype('<u4').ravel()
    bin_ = v.tobytes() + n.tobytes() + idx.tobytes()
    gltf = {"asset": {"version": "2.0", "generator": "kk-convert"}, "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "name": name}],
            "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
            "materials": [{"name": "Silicone", "pbrMetallicRoughness": {"baseColorFactor": COLOR, "metallicFactor": 0.0, "roughnessFactor": 0.42}}],
            "buffers": [{"byteLength": len(bin_)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": v.nbytes, "target": 34962},
                            {"buffer": 0, "byteOffset": v.nbytes, "byteLength": n.nbytes, "target": 34962},
                            {"buffer": 0, "byteOffset": v.nbytes + n.nbytes, "byteLength": idx.nbytes, "target": 34963}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(v), "type": "VEC3", "min": v.min(0).tolist(), "max": v.max(0).tolist()},
                          {"bufferView": 1, "componentType": 5126, "count": len(n), "type": "VEC3"},
                          {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"}]}
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4); bin_ += b'\0' * (-len(bin_) % 4)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_)))
        fh.write(struct.pack('<I4s', len(js), b'JSON')); fh.write(js)
        fh.write(struct.pack('<I4s', len(bin_), b'BIN\0')); fh.write(bin_)

m = trimesh.load(src, process=False, force='mesh'); m = trimesh.Trimesh(m.vertices, m.faces, process=True)
v = np.asarray(m.vertices, dtype=np.float64); f = np.asarray(m.faces)
# stand on the ground, centred, millimetres -> metres
c = (v.min(0) + v.max(0)) / 2; v = (v - [c[0], v[:, 1].min(), c[2]]) * 0.001
full = len(f); out = {}
for label, target in (('high', None), ('medium', 50000), ('light', 25000), ('lean', 12000)):
    if target is None or target >= full: vv, ff = v, f
    else: vv, ff = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), target_count=target, agg=5)
    tm = trimesh.Trimesh(np.asarray(vv, dtype=np.float64), np.asarray(ff), process=False)
    write_glb(f'{name}_{label}_raw.glb', tm.vertices, np.asarray(tm.vertex_normals), tm.faces)
    out[label] = {'tris': int(len(tm.faces)), 'verts': int(len(tm.vertices)), 'watertight': bool(tm.is_watertight),
                  'size_mm': (tm.extents * 1000).round(1).tolist()}
print(json.dumps(out, indent=1))
