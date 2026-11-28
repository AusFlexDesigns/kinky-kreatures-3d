"""Turn a finished web model round without rebuilding it from the studio file.

    python reorient.py <model.kkm> <x|y|z> [degrees=180]

Rewrites <model>.kkm (positions and its object-space normal map) and <model>-ar.glb (a rotation on its
nodes, which model-viewer, Scene Viewer and Quick Look all honour). Only 180° turns are supported, so the
normal map is rotated exactly by flipping two colour channels.
"""
import sys, io, json, struct, numpy as np
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
from kkbuild import keystream, pack_kkm

path, axis = sys.argv[1], sys.argv[2]
deg = float(sys.argv[3]) if len(sys.argv) > 3 else 180
assert deg == 180, 'only 180 degree turns'
flip = {'x': (1, 2), 'y': (0, 2), 'z': (0, 1)}[axis]          # axes whose sign changes


def unpack(enc):
    body = np.frombuffer(enc[::-1], np.uint8)
    seed = (0x4B4B5231 ^ (len(body) * 2654435761)) & 0xFFFFFFFF
    raw = (body ^ keystream(len(body), seed)).tobytes()
    magic, nV, nT, texLen = struct.unpack_from('<4sIII', raw, 0); assert magic == b'KKM1'
    bmin = np.array(struct.unpack_from('<3f', raw, 16)); bsize = np.array(struct.unpack_from('<3f', raw, 28))
    pad = lambda x: x + (-x % 4); off = 40
    qp = np.frombuffer(raw, '<u2', nV * 3, off).reshape(-1, 3); off = pad(off + nV * 6)
    quv = np.frombuffer(raw, '<u2', nV * 2, off).reshape(-1, 2); off = pad(off + nV * 4)
    qi = np.frombuffer(raw, '<u2', nT * 3, off); off = pad(off + nT * 6)
    pos = bmin + qp / 65535 * bsize
    return pos, quv / 65535, qi, raw[off:off + texLen]


enc = open(path, 'rb').read()
pos, uv, idx, tex = unpack(enc)
lo, hi = pos.min(0), pos.max(0)
for a in flip: pos[:, a] = lo[a] + hi[a] - pos[:, a]          # mirror within the same box, so it sits where it did
img = np.array(Image.open(io.BytesIO(tex)).convert('RGB'))
for a in flip: img[..., a] = 255 - img[..., a]
buf = io.BytesIO(); Image.fromarray(img).save(buf, 'WEBP', quality=95, method=6)
open(path, 'wb').write(pack_kkm(pos.astype(np.float32), uv.astype(np.float32), idx, buf.getvalue()))
print('kkm turned', axis, len(enc) // 1024, '->', len(open(path, 'rb').read()) // 1024, 'KB')

# AR model: put a 180° turn on every root node
glb = path[:-4] + '-ar.glb'
try: data = open(glb, 'rb').read()
except FileNotFoundError: sys.exit(0)
magic, ver, total = struct.unpack_from('<4sII', data, 0)
jlen, jtype = struct.unpack_from('<II', data, 12); assert jtype == 0x4E4F534A
js = json.loads(data[20:20 + jlen]); rest = data[20 + jlen:]
q = {'x': [1, 0, 0, 0], 'y': [0, 1, 0, 0], 'z': [0, 0, 1, 0]}[axis]
def qmul(a, b):   # x, y, z, w
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
roots = js['scenes'][js.get('scene', 0)]['nodes']
for r in roots:
    n = js['nodes'][r]
    if 'matrix' in n: raise SystemExit('node has a matrix; not handled')
    assert 'rotation' not in n and 'translation' not in n and 'scale' not in n, 'root node already transformed'
    acc = js['accessors'][js['meshes'][n['mesh']]['primitives'][0]['attributes']['POSITION']]
    n['rotation'] = q
    n['translation'] = [(acc['min'][i] + acc['max'][i]) if i in flip else 0 for i in range(3)]   # keep the same box
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4)
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + len(rest)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + rest
open(glb, 'wb').write(out)
print('glb turned', axis)
