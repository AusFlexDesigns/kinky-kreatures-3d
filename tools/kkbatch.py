"""Watch a folder of staged mould files and turn each into viewer files with kkbuild.py.

    python tools/kkbatch.py <watch_dir> <models_dir> <work_dir>

File names follow the studio's export convention, e.g.
    KRE_DLD_Kraken_FullRes_LRG_SuctionCup.stl  ->  models/kraken/large-suction.kkm (+ -ar.glb)
    KRE_KNT_Wolf_FullRes_WellEndowed.stl       ->  models/cock-knots/wolf-well.kkm
Files too big to stage in one piece arrive as <name>.stl.partNofM and are joined first.
Each source is deleted once converted; results go to <work_dir>/results.jsonl, previews to <work_dir>/prev/.
"""
import os, sys, re, json, time, subprocess, glob, struct

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = {'XS': 'xsmall', 'XSML': 'xsmall', 'SML': 'small', 'MID': 'medium', 'LRG': 'large', 'XLRG': 'xlarge'}
BASES = {'FlatBase': 'flat', 'SuctionCup': 'suction', 'MastBase': 'mast', 'MachineBase': 'machine', 'VibeBase': 'vibe'}
FITS = {'Standard': 'standard', 'WellEndowed': 'well'}
TOYS = {'Draco': 'draco', 'DragonSheath': 'dragon-sheath', 'Giga': 'giga', 'HornedDevil': 'horned-devil', 'Kaden': 'kaden',
        'Kaio': 'kaio', 'Kraken': 'kraken', 'Krescent': 'krescent', 'Kristal': 'kristal', 'OctoPlug': 'octoplug',
        'Saddleback': 'saddleback', 'Slime': 'slime', 'Sole': 'sole', 'DuoSole': 'duo-sole', 'TentacleVibeWrap': 'vibe-wrap',
        'TheBlackLotus': 'black-lotus', 'Tiamat': 'tiamat', 'UnicornHead': 'unicorn-head', 'Zilla': 'zilla',
        'TheCoreNode': ('cyber-tech', 'core-node'), 'TheMatrixRoot': ('cyber-tech', 'matrix-root'), 'TheSub-Net': ('cyber-tech', 'sub-net')}


def target(fname):
    """(toy folder, variant id) for a studio file name, or None."""
    m = re.match(r'KRE_([A-Z]+)_(.+?)_(?:FullRes|HighRes)(?:_(.*))?\.stl$', fname, re.I)
    if not m: return None
    cat, name, rest = m.group(1).upper(), m.group(2), (m.group(3) or '')
    toks = [t for t in rest.split('_') if t]
    size = next((SIZES[t] for t in toks if t in SIZES), None)
    base = next((BASES[t] for t in toks if t in BASES), None)
    fit = next((FITS[t] for t in toks if t in FITS), None)
    t = TOYS.get(name)
    if cat == 'KNT' and name not in TOYS:                      # cock knot designs: <design>-<fit>
        return 'cock-knots', f'{name.lower()}-{fit or "standard"}'
    if isinstance(t, tuple):                                   # several toys sold as one product
        return t[0], '-'.join(x for x in (t[1], base or fit) if x)
    if not t: return None
    return t, '-'.join(x for x in (size, base or fit) if x) or 'main'


ORIENT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orient.json')))
FORCE = set(open('/tmp/kk/force.txt').read().split()) if os.path.exists('/tmp/kk/force.txt') else set()   # always merge to one solid
THIN = {'cock-knots', 'dragon-sheath', 'tiamat', 'black-lotus', 'vibe-wrap'}


def join_parts(first):
    """Join <x>.stl.part1ofN .. partNofN (binary STL triangle records split on 50-byte boundaries)."""
    m = re.match(r'(.+\.stl)\.part1of(\d+)$', first)
    stem, n = m.group(1), int(m.group(2))
    parts = [f'{stem}.part{i}of{n}' for i in range(1, n + 1)]
    if not all(os.path.exists(p) and stable(p) for p in parts): return None
    out = os.path.join('/tmp/kk/join', os.path.basename(stem)); os.makedirs(os.path.dirname(out), exist_ok=True)
    tris = sum((os.path.getsize(p) - 84) // 50 for p in parts)
    with open(out, 'wb') as w:
        w.write(b'joined'.ljust(80, b' ')); w.write(struct.pack('<I', tris))
        for p in parts:
            with open(p, 'rb') as r:
                r.seek(84)
                while True:
                    b = r.read(1 << 24)
                    if not b: break
                    w.write(b)
    return out, parts


_sizes = {}
def stable(p):
    s = os.path.getsize(p); prev = _sizes.get(p); _sizes[p] = s
    return prev == s and s > 84


def main():
    watch, models, work = sys.argv[1:4]
    os.makedirs(os.path.join(work, 'prev'), exist_ok=True)
    done = set()
    resf = os.path.join(work, 'results.jsonl')
    if os.path.exists(resf):
        done = {json.loads(l)['file'] for l in open(resf) if l.strip()}
    redo = os.path.join(work, 'redo.txt')
    if os.path.exists(redo): done -= set(open(redo).read().split())
    idle = 0
    while True:
        files = sorted(glob.glob(os.path.join(watch, '**', '*.stl'), recursive=True) +
                       glob.glob(os.path.join(watch, '**', '*.stl.part1of*'), recursive=True))
        did = False
        for p in files:
            name = re.sub(r'\.part1of\d+$', '', os.path.basename(p))
            if name in done: continue
            srcs = [p]; src = p
            if '.part1of' in p:
                j = join_parts(p)
                if not j: continue
                src, srcs = j[0], j[1]
            elif not stable(p): continue
            t = target(name)
            rec = {'file': name}
            if not t:
                rec['error'] = 'name not recognised'
            else:
                toy, vid = t; out = os.path.join(models, toy)
                shrunk = None
                if os.path.getsize(src) > 200e6:   # very large sculpt: build from a lean 1.5M-triangle working copy
                    shrunk = os.path.join('/tmp/kk/shrunk', f'{toy}-{vid}.stl'); os.makedirs(os.path.dirname(shrunk), exist_ok=True)
                    s0 = subprocess.run([sys.executable, os.path.join(HERE, 'preshrink.py'), src, shrunk], capture_output=True, text=True)
                    if s0.returncode == 0: src_build = shrunk
                    else: src_build = src; rec['shrink_error'] = 'exit %s: %s' % (s0.returncode, (s0.stderr or s0.stdout)[-300:])
                else: src_build = src
                cmd = [sys.executable, os.path.join(HERE, 'kkbuild.py'), src_build, out, vid, '--zup',
                       '--preview', os.path.join(work, 'prev', f'{toy}-{vid}.png')]
                # sleeves, knots and masturbators have thin walls close together: keep more triangles so the
                # simplifier never pulls the outer wall through the inner one
                thin = toy in THIN or vid.startswith('sub-net')
                target_tris = 12000 if thin else 4000
                if thin: cmd += ['--display', '12000', '--display-res', '2048', '--ar', '24000']
                t0 = time.time(); r = subprocess.run(cmd, capture_output=True, text=True)
                rec.update(toy=toy, id=vid, secs=round(time.time() - t0))
                lines = [l for l in r.stdout.splitlines() if l.startswith('{')]
                if r.returncode == 0 and lines: rec.update(json.loads(lines[-1]))
                else: rec['error'] = (r.stderr or r.stdout)[-600:]
                # a sculpt made of overlapping pieces won't decimate (display stays far over target, surface
                # goes jagged): merge it into one solid shell first and build again from that
                if not rec.get('error') and (rec.get('display_tris', 0) > target_tris * 1.075 or name in FORCE):
                    solid = os.path.join('/tmp/kk/solid', f'{toy}-{vid}.ply'); os.makedirs(os.path.dirname(solid), exist_ok=True)
                    s1 = subprocess.run([sys.executable, os.path.join(HERE, 'solidify.py'), src_build, solid, '0.3'], capture_output=True, text=True)
                    if s1.returncode == 0 and os.path.exists(solid):
                        cmd[2] = solid; r = subprocess.run(cmd + ['--detail', src_build], capture_output=True, text=True)   # shape from the solid, skin detail from the sculpt
                        lines = [l for l in r.stdout.splitlines() if l.startswith('{')]
                        if r.returncode == 0 and lines: rec.update(json.loads(lines[-1])); rec['solidified'] = True
                        else: rec['solid_error'] = (r.stderr or r.stdout)[-400:]
                        try: os.remove(solid)
                        except OSError: pass
                    else: rec['solid_error'] = 'exit %s: %s' % (s1.returncode, (s1.stderr or s1.stdout)[-400:])
                    rec['secs'] = round(time.time() - t0)
                turn = ORIENT.get(f'{toy}/{vid}')
                if turn and not rec.get('error'):
                    subprocess.run([sys.executable, os.path.join(HERE, 'reorient.py'), os.path.join(out, vid + '.kkm'), turn], check=False)
                    rec['turned'] = turn
                if shrunk and os.path.exists(shrunk): os.remove(shrunk); rec['preshrunk'] = True
            with open(resf, 'a') as f: f.write(json.dumps(rec) + '\n')
            done.add(name); did = True
            for s in srcs + ([src] if src not in srcs else []):
                try: os.remove(s)
                except OSError: pass
        idle = 0 if did else idle + 1
        if os.path.exists(os.path.join(work, 'STOP')) and idle > 2: break
        time.sleep(5)


if __name__ == '__main__':
    main()
