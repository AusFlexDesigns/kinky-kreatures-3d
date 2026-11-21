"""Pack low mesh + normal map into the scrambled .kkm container (stored as base64 JSON for this test page)."""
import sys, struct, json, base64, numpy as np
target = sys.argv[1]; d = np.load(f'low_{target}.npz'); tex = open(f'nrm_{target}.webp', 'rb').read()
pos, uv, idx = d['pos'], d['uv'], d['idx'].ravel()
bmin = pos.min(0); bsize = pos.max(0) - bmin
qp = np.round((pos - bmin) / bsize * 65535).astype('<u2'); quv = np.round(np.clip(uv, 0, 1) * 65535).astype('<u2'); qi = idx.astype('<u2'); assert len(pos) < 65536
def pad(b): return b + b'\0' * (-len(b) % 4)
body = struct.pack('<4sIII3f3f', b'KKM1', len(pos), len(idx) // 3, len(tex), *bmin.tolist(), *bsize.tolist()) + pad(qp.tobytes()) + pad(quv.tobytes()) + pad(qi.tobytes()) + tex
def keystream(n, seed):
    out = np.empty(n, np.uint8); a = seed & 0xFFFFFFFF
    for i in range(n):
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF; t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        out[i] = ((t ^ (t >> 14)) & 0xFFFFFFFF) & 0xFF
    return out
seed = (0x4B4B5231 ^ (len(body) * 2654435761)) & 0xFFFFFFFF
enc = (np.frombuffer(body, np.uint8) ^ keystream(len(body), seed)).tobytes()[::-1]
json.dump([base64.b64encode(enc).decode()], open('site/models/kraken_large_protected.json', 'w'))
open(f'kraken_large_{target}.kkm', 'wb').write(enc)
print('verts', len(pos), 'tris', len(idx) // 3, 'tex KB', len(tex) // 1024, 'container KB', len(enc) // 1024, 'starts', enc[:12].hex())
