// Kinky Kreatures 3D toy viewer — a Wix custom element.
// Usage on a page: <kk-toy-viewer model="kraken"></kk-toy-viewer>
// Optional attributes: size="large", assets="https://.../models/" (override where models load from).
import {
  Raycaster, TorusGeometry, Quaternion,
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, DirectionalLight, Mesh, PlaneGeometry, ShadowMaterial,
  Group, Box3, Vector3, Vector2, Plane, MeshStandardMaterial, MeshBasicMaterial, BufferGeometry, BufferAttribute,
  Float32BufferAttribute, LineSegments, LineBasicMaterial, Sprite, SpriteMaterial, CanvasTexture, LatheGeometry, Texture,
  Color, ACESFilmicToneMapping, PCFShadowMap, NoColorSpace, ObjectSpaceNormalMap, BackSide, FrontSide,
  AlwaysStencilFunc, NotEqualStencilFunc, IncrementWrapStencilOp, DecrementWrapStencilOp, ReplaceStencilOp,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Models load from the same release as this script (…/dist/kk-viewer.js → …/models/), so a new tag
// moves the viewer and its models together. __VERSION__ is filled in at build time as a fallback.
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'main';
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const DEFAULT_ASSETS = /\/dist\/kk-viewer(\.min)?\.js(\?.*)?$/.test(SCRIPT_SRC)
  ? SCRIPT_SRC.replace(/\/dist\/kk-viewer(\.min)?\.js(\?.*)?$/, '/models/')
  : 'https://cdn.jsdelivr.net/gh/AusFlexDesigns/kinky-kreatures-3d@' + VERSION + '/models/';
const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js';
const CANS = {
  soda: { label: 'Soda can 375 ml', h: 0.115, r: 0.033, color: '#c8202a' },
  monster: { label: 'Monster can 500 ml', h: 0.157, r: 0.033, color: '#1f2a1f' },
};

// ---- scrambled model container (.kkm): decoded in memory only ----
function unscramble(enc) {
  const n = enc.length, out = new Uint8Array(n); let a = (0x4B4B5231 ^ Math.imul(n, 2654435761)) >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ ((t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0)) >>> 0)) >>> 0;
    out[i] = enc[n - 1 - i] ^ ((t ^ (t >>> 14)) & 255);
  }
  return out;
}
async function decodeKkm(buf, color) {
  const raw = unscramble(new Uint8Array(buf)); const dv = new DataView(raw.buffer);
  if (dv.getUint32(0, true) !== 0x314D4B4B) throw new Error('Unrecognised model file');
  const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true), texLen = dv.getUint32(12, true);
  const bmin = [16, 20, 24].map((o) => dv.getFloat32(o, true)), bsize = [28, 32, 36].map((o) => dv.getFloat32(o, true));
  const pad = (x) => x + ((4 - (x % 4)) % 4); let off = 40;
  const qp = new Uint16Array(raw.buffer, off, nV * 3); off = pad(off + nV * 6);
  const quv = new Uint16Array(raw.buffer, off, nV * 2); off = pad(off + nV * 4);
  const qi = new Uint16Array(raw.buffer, off, nT * 3); off = pad(off + nT * 6);
  const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  for (let i = 0; i < nV * 3; i++) pos[i] = bmin[i % 3] + (qp[i] / 65535) * bsize[i % 3];
  for (let i = 0; i < nV * 2; i++) uv[i] = quv[i] / 65535;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(new Uint16Array(qi), 1)); g.computeVertexNormals();
  const bmp = await createImageBitmap(new Blob([raw.slice(off, off + texLen)], { type: 'image/webp' }));
  const tex = new Texture(bmp); tex.flipY = false; tex.colorSpace = NoColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
  const mat = new MeshStandardMaterial({ color: new Color(color), roughness: 0.42, metalness: 0, normalMap: tex, normalMapType: ObjectSpaceNormalMap });
  const mesh = new Mesh(g, mat); mesh.castShadow = true; mesh.renderOrder = 6; return mesh;
}


// ---- diameter gauge: cross-sections taken square to the toy's centre line ----
function sliceTri(pos, idx, c, n, u, v, out) {
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = P(idx[t]), b = P(idx[t + 1]), d = P(idx[t + 2]);
    const s = [a, b, d].map((p) => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]);
    const tri = [a, b, d];
    for (let e = 0; e < 3; e++) {
      const i = e, j = (e + 1) % 3;
      if ((s[i] > 0) === (s[j] > 0)) continue;
      const k = s[i] / (s[i] - s[j]), pi = tri[i], pj = tri[j];
      const q = [pi[0] + (pj[0] - pi[0]) * k - c[0], pi[1] + (pj[1] - pi[1]) * k - c[1], pi[2] + (pj[2] - pi[2]) * k - c[2]];
      out.push([q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * v[0] + q[1] * v[1] + q[2] * v[2]]);
    }
  }
  return out;
}
function hull2(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function computeSections(geometry, count = 90) {
  const pos = geometry.attributes.position.array, idx = geometry.index.array;
  geometry.computeBoundingBox(); const bb = geometry.boundingBox, h = bb.max.y - bb.min.y;
  // centre line from horizontal slices, smoothed
  const ys = [], cs = [];
  for (let i = 0; i < count; i++) {
    const y = bb.min.y + h * (0.03 + 0.94 * (i / (count - 1)));
    const pts = sliceTri(pos, idx, [0, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], []);
    if (pts.length < 6) continue;
    let sx = 0, sz = 0; for (const q of pts) { sx += q[0]; sz += q[1]; }
    ys.push(y); cs.push([sx / pts.length, y, sz / pts.length]);
  }
  const sm = cs.map((_, i) => { let a = [0, 0, 0], n = 0; for (let j = Math.max(0, i - 4); j <= Math.min(cs.length - 1, i + 4); j++) { a = [a[0] + cs[j][0], a[1] + cs[j][1], a[2] + cs[j][2]]; n++; } return [a[0] / n, a[1] / n, a[2] / n]; });
  const out = [];
  for (let i = 0; i < sm.length; i++) {
    const p0 = sm[Math.max(0, i - 2)], p1 = sm[Math.min(sm.length - 1, i + 2)];
    const n = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const u = norm3(cross3(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1])), v = cross3(n, u);
    let pts = sliceTri(pos, idx, sm[i], n, u, v, []);
    if (pts.length < 6) continue;
    // keep the loop around the centre line, not far cuts through other parts of the toy
    const d = pts.map((q) => Math.hypot(q[0], q[1])).sort((a, b) => a - b), lim = d[Math.floor(d.length / 2)] * 1.8;
    pts = pts.filter((q) => Math.hypot(q[0], q[1]) <= lim);
    const H = hull2(pts); if (H.length < 3) continue;
    let best = 0, A = H[0], B = H[0], per = 0, cx = 0, cy = 0;
    for (let a = 0; a < H.length; a++) {
      const q = H[a], r = H[(a + 1) % H.length]; per += Math.hypot(r[0] - q[0], r[1] - q[1]); cx += q[0]; cy += q[1];
      for (let b = a + 1; b < H.length; b++) { const w = Math.hypot(H[b][0] - q[0], H[b][1] - q[1]); if (w > best) { best = w; A = q; B = H[b]; } }
    }
    cx /= H.length; cy /= H.length;
    const to3 = (q) => [sm[i][0] + u[0] * q[0] + v[0] * q[1], sm[i][1] + u[1] * q[0] + v[1] * q[1], sm[i][2] + u[2] * q[0] + v[2] * q[1]];
    out.push({ y: sm[i][1], centre: to3([cx, cy]), normal: n, diameter: best, girth: per, a: to3(A), b: to3(B) });
  }
  return out;
}

let modelViewerPromise = null;
const downloads = new Map();
function download(url, kind) {
  const key = kind + ' ' + url;
  if (!downloads.has(key)) downloads.set(key, fetch(url).then((r) => { if (!r.ok) { downloads.delete(key); throw new Error(url.split('/').pop() + ' ' + r.status); } return kind === 'json' ? r.json() : r.arrayBuffer(); }));
  return downloads.get(key);
}
function loadModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  if (!modelViewerPromise) {
    modelViewerPromise = new Promise((ok, no) => {
      const s = document.createElement('script'); s.type = 'module'; s.src = MODEL_VIEWER;
      s.onload = () => customElements.whenDefined('model-viewer').then(ok); s.onerror = () => no(new Error('AR library failed to load'));
      document.head.appendChild(s);
    });
  }
  return modelViewerPromise;
}

const AR_ICON = 'data:image/png;base64,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';
const ICON = {
  ruler: '<path d="M8 3h8v18H8z"/><path d="M8 7h4M8 11h3M8 15h4M8 19h3"/>',
  soda: '<path d="M8 5h8l1 2v12l-1 2H8l-1-2V7z"/><path d="M9 3h6"/>',
  monster: '<path d="M8.5 2.5h7l1 2v15l-1 2h-7l-1-2v-15z"/><path d="M10 9l1.2 6L12 11l.8 4L14 9"/>',
  cut: '<path d="M10 3c-2 3-3 6-3 10s1 6 3 8z"/><path d="M14 3c2 3 3 6 3 10s-1 6-3 8z"/><path d="M4 12h2M18 12h2"/>',
  base: '<ellipse cx="12" cy="16" rx="8" ry="3.5"/><path d="M8 15V8c0-2 2-5 4-5s4 3 4 5v7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  gauge: '<path d="M9 2.5v19M15 2.5v19"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/>',
  ar: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5"/>',
};
const svg = (k) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const CSS = `
:host{display:block;position:relative;width:100%;height:100%;min-height:480px;font-family:var(--kk-font,inherit);color:#fff;-webkit-tap-highlight-color:transparent}
*{box-sizing:border-box}
.wrap{position:absolute;inset:0;overflow:hidden;border-radius:var(--kk-radius,0);background:var(--kk-bg,radial-gradient(120% 90% at 30% 20%,#3a2f7a 0%,#231455 55%,#150a33 100%));container-type:inline-size}
.stage{position:absolute;inset:0}
.stage canvas{display:block;width:100%;height:100%;outline:none}
button{font:inherit;color:inherit;cursor:pointer}
.col{position:absolute;display:flex;flex-direction:column;gap:10px;z-index:2}
.tools{left:16px;top:50%;transform:translateY(-50%)}
.views{left:16px;bottom:16px;flex-direction:row}
.icon{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border-radius:14px;border:1.5px solid rgba(255,255,255,.28);background:rgba(21,10,51,.55);backdrop-filter:blur(6px)}
.icon svg{width:26px;height:26px}
.icon[aria-pressed="true"]{background:var(--kk-accent,#ff4d6d);border-color:var(--kk-accent,#ff4d6d)}
.icon:focus-visible,.size:focus-visible,.chip:focus-visible,.ar:focus-visible{outline:3px solid #fff;outline-offset:2px}
.sizes{right:20px;top:50%;transform:translateY(-50%);gap:4px;align-items:flex-end}
.size{min-height:44px;padding:0 6px;border:0;background:none;font-size:clamp(15px,2.2vw,20px);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.72);text-align:right}
.size[aria-pressed="true"]{color:var(--kk-accent,#ff4d6d)}
.size small{display:block;font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:none;color:rgba(255,255,255,.72)}
.bases{left:50%;bottom:16px;transform:translateX(-50%);flex-direction:row;flex-wrap:wrap;justify-content:center}
.chip{min-height:40px;padding:0 14px;border-radius:999px;border:1.5px solid rgba(255,255,255,.28);background:rgba(21,10,51,.55);font-size:12.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.chip[hidden]{display:none}
.chip[aria-pressed="true"]{background:#fff;color:#150a33;border-color:#fff}
.ar{position:absolute;right:12px;top:12px;z-index:2;display:block;width:64px;height:74px;padding:4px;border:0;border-radius:14px;background:none;cursor:pointer;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35));transition:transform .15s}
.ar:hover{transform:scale(1.06)}
.ar img{display:block;width:100%;height:100%;object-fit:contain}
.ar[hidden]{display:none}
.readout{position:absolute;left:0;top:0;z-index:2;margin:0;padding:6px 10px;border-radius:10px;background:rgba(21,10,51,.82);border:1.5px solid var(--kk-accent,#ff4d6d);font-size:15px;font-weight:800;line-height:1.25;white-space:nowrap;cursor:ns-resize;touch-action:none;user-select:none;transform:translate(0,-50%)}
.readout::before{content:'⇕';float:left;margin:2px 8px 0 0;font-size:16px;color:var(--kk-accent,#ff4d6d)}
.readout small{display:block;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.75)}
.readout[hidden]{display:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.note{position:absolute;right:16px;top:94px;z-index:3;max-width:240px;margin:0;padding:10px 12px;border-radius:12px;background:#fff;color:#150a33;font-size:13px;line-height:1.4;font-weight:600}
.note[hidden]{display:none}
.hint{position:absolute;right:16px;bottom:16px;z-index:1;margin:0;font-size:12px;font-weight:600;color:rgba(255,255,255,.7)}
.status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:4;margin:0;font-size:15px;font-weight:700;pointer-events:none}
.status[hidden]{display:none}
.mv{position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none}
@container (max-width:620px){
  .sizes{top:16px;right:auto;left:16px;transform:none;flex-direction:row;flex-wrap:wrap;align-items:center;gap:2px 10px;max-width:calc(100% - 150px)}
  .size{min-height:40px;padding:0 2px;font-size:14px;text-align:left}
  .size small{display:none}
  .tools{left:12px;top:auto;bottom:76px;transform:none}
  .views{left:12px;bottom:12px}
  .icon{width:44px;height:44px}
  .bases{bottom:70px;left:auto;right:12px;transform:none;flex-direction:column;align-items:flex-end}
  .hint{bottom:18px;right:12px;max-width:130px;text-align:right}
  .chip{min-height:34px;padding:0 11px;font-size:11px}
  .readout{font-size:13px}
}
@container (max-width:360px){ .hint{display:none} }`;

class KKToyViewer extends HTMLElement {
  static get observedAttributes() { return ['model', 'size']; }

  connectedCallback() {
    if (this._root) return;
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>${CSS}</style>
<div class="wrap">
  <div class="stage" part="stage"></div>
  <p class="status" role="status">Loading 3D model…</p>
  <div class="col tools" role="group" aria-label="Size references">
    <button class="icon" data-t="ruler" aria-pressed="false" aria-label="Show ruler" title="Ruler">${svg('ruler')}</button>
    <button class="icon" data-t="soda" aria-pressed="false" aria-label="Show soda can for scale" title="Soda can">${svg('soda')}</button>
    <button class="icon" data-t="monster" aria-pressed="false" aria-label="Show Monster can for scale" title="Monster can">${svg('monster')}</button>
    <button class="icon" data-g aria-pressed="false" aria-label="Measure diameter. Drag the ring, or use the up and down arrow keys" title="Diameter">${svg('gauge')}</button>
  </div>
  <div class="col views" role="group" aria-label="Views">
    <button class="icon" data-v="cut" aria-pressed="false" aria-label="Cutaway view" title="See inside">${svg('cut')}</button>
    <button class="icon" data-v="base" aria-label="View the base" title="View the base">${svg('base')}</button>
    <button class="icon" data-v="reset" aria-label="Reset view" title="Reset view">${svg('reset')}</button>
  </div>
  <div class="col sizes" role="group" aria-label="Size"></div>
  <div class="col bases" role="group" aria-label="Base"></div>
  <button class="ar" hidden aria-label="View in your space with augmented reality" title="View in your space (AR)"><img src="${AR_ICON}" alt=""></button>
  <p class="readout" hidden></p>
  <p class="sr" aria-live="polite"></p>
  <p class="note" hidden></p>
  <p class="hint">Drag to rotate · scroll or pinch to zoom</p>
  <div class="mv"></div>
</div>`;
    this._$ = (s) => this._root.querySelector(s);
    this._io = new IntersectionObserver((e) => {
      this._visible = e.some((x) => x.isIntersecting);
      if (this._visible && !this._started) this._start();
    }, { rootMargin: '200px' });
    this._io.observe(this);
  }

  disconnectedCallback() {
    if (this._io) this._io.disconnect();
    if (this._ro) this._ro.disconnect();
    if (this._renderer) { this._renderer.setAnimationLoop(null); this._renderer.dispose(); }
  }

  attributeChangedCallback(name, oldV, newV) {
    if (!this._started || oldV === newV) return;
    if (name === 'model') this._loadManifest().catch((e) => this._fail(e));
    if (name === 'size' && newV) this._selectSize(newV);
  }

  get _assets() {
    const a = this.getAttribute('assets') || DEFAULT_ASSETS;
    return a.endsWith('/') ? a : a + '/';
  }

  _fail(e) {
    const st = this._$('.status'); st.hidden = false; st.textContent = '3D model couldn’t load. Please refresh the page.';
    console.warn('[kk-toy-viewer]', e);
  }

  _start() {
    this._started = true;
    try { this._initScene(); } catch (e) { this._fail(e); return; }
    this._bindUi();
    this._loadManifest().catch((e) => this._fail(e));
  }

  _initScene() {
    const stage = this._$('.stage');
    const r = new WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    r.localClippingEnabled = true;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = PCFShadowMap;
    stage.appendChild(r.domElement);
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this._renderer = r;

    const scene = new Scene(); this._scene = scene;
    scene.environment = new PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    const cam = new PerspectiveCamera(32, 1, 0.01, 20); this._camera = cam;
    const c = new OrbitControls(cam, r.domElement); this._controls = c;
    c.enableDamping = true; c.enablePan = false; c.minDistance = 0.2; c.maxDistance = 2.4; c.maxPolarAngle = Math.PI;
    // vertical finger drags scroll the page; sideways drags spin the toy
    r.domElement.style.touchAction = 'pan-y';
    c.addEventListener('change', () => { this._dirty = true; });

    const key = new DirectionalLight(0xffffff, 2.2); key.position.set(0.5, 0.9, 0.6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4, near: 0.1, far: 3 });
    key.shadow.bias = -0.0005; scene.add(key);
    const ground = new Mesh(new PlaneGeometry(4, 4), new ShadowMaterial({ opacity: 0.3 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    this._toy = new Group(); this._extras = new Group(); this._cutGroup = new Group();
    scene.add(this._toy, this._extras, this._cutGroup);
    this._cutPlane = new Plane(new Vector3(-1, 0, 0), 10);
    this._cap = new Mesh(new PlaneGeometry(0.6, 0.8), new MeshStandardMaterial({
      color: 0x8f6cf0, roughness: 0.7, metalness: 0, stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc,
      stencilFail: ReplaceStencilOp, stencilZFail: ReplaceStencilOp, stencilZPass: ReplaceStencilOp,
    }));
    this._cap.rotation.y = Math.PI / 2; this._cap.renderOrder = 1.1; this._cap.visible = false;
    this._cap.onAfterRender = (rr) => rr.clearStencil(); scene.add(this._cap);

    this._gauge = new Group(); this._gauge.visible = false; scene.add(this._gauge);
    this._ring = new Mesh(new TorusGeometry(1, 0.035, 12, 96), new MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.35, metalness: 0.1, emissive: 0x5a0f22 }));
    this._ringHit = new Mesh(new TorusGeometry(1, 0.45, 8, 48), new MeshBasicMaterial({ visible: false }));
    this._span = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this._span.renderOrder = 9; this._ring.renderOrder = 8;
    this._gauge.add(this._ring, this._ringHit, this._span);
    this._ray = new Raycaster();
    this._size3 = new Vector3(0.1, 0.3, 0.1);
    this._state = { ruler: false, can: 'none', cut: false, gauge: false }; this._refs = {}; this._gaugeAt = 0.5;
    this._cache = {};

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
      r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); this._dirty = true;
    };
    this._ro = new ResizeObserver(resize); this._ro.observe(stage); resize();
    r.setAnimationLoop(() => {
      if (!this._visible) return;
      const moved = c.update();
      if (moved || this._dirty || this._anim) { r.render(scene, cam); this._dirty = false; if (this._state.gauge) this._placeReadout(); }
    });
  }

  _bindUi() {
    this._root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.t;
      if (t === 'ruler') this._state.ruler = !this._state.ruler;
      else this._state.can = this._state.can === t ? 'none' : t;
      this._root.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === 'ruler' ? this._state.ruler : x.dataset.t === this._state.can)));
      this._buildExtras(); this._frame();
    }));
    this._$('[data-v="cut"]').addEventListener('click', (e) => { this._setCut(!this._state.cut); e.currentTarget.setAttribute('aria-pressed', String(this._state.cut)); });
    this._$('[data-v="base"]').addEventListener('click', () => this._viewBase());
    this._$('[data-v="reset"]').addEventListener('click', () => { if (this._state.cut) { this._setCut(false); this._$('[data-v="cut"]').setAttribute('aria-pressed', 'false'); } this._frame(); });
    this._$('.ar').addEventListener('click', () => this._openAR());
    const g = this._$('[data-g]');
    g.addEventListener('click', () => this._setGauge(!this._state.gauge));
    g.addEventListener('keydown', (e) => {
      if (!this._state.gauge || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault(); this._moveGauge(this._gaugeAt + (e.key === 'ArrowUp' ? 0.02 : -0.02));
    });
    this._bindGaugeDrag();
  }

  // ---- diameter gauge ----
  _setGauge(on) {
    this._state.gauge = on; this._$('[data-g]').setAttribute('aria-pressed', String(on));
    this._gauge.visible = on; this._$('.readout').hidden = !on;
    // while measuring, finger drags belong to the viewer (so the ring can slide up and down) instead of scrolling the page
    this._renderer.domElement.style.touchAction = on ? 'none' : 'pan-y';
    if (on) this._moveGauge(this._gaugeAt); else this._dirty = true;
  }

  _sections() {
    const mesh = this._toy.children[0]; if (!mesh) return [];
    if (!mesh.userData.sections) mesh.userData.sections = computeSections(mesh.geometry);
    return mesh.userData.sections;
  }

  _moveGauge(t) {
    const S = this._sections(); if (!S.length) return;
    this._gaugeAt = Math.min(1, Math.max(0, t));
    const sec = S[Math.round(this._gaugeAt * (S.length - 1))]; this._sec = sec;
    const R = sec.diameter / 2 + 0.006;
    this._ring.scale.set(R, R, R); this._ring.geometry.dispose();
    this._ring.geometry = new TorusGeometry(1, 0.0022 / R, 12, 96);
    this._ringHit.scale.set(R, R, R);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...sec.normal));
    for (const o of [this._ring, this._ringHit]) { o.position.set(...sec.centre); o.quaternion.copy(q); }
    this._span.geometry.dispose();
    this._span.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([...sec.a, ...sec.b], 3));
    const cm = sec.diameter * 100, gcm = sec.girth * 100;
    this._$('.readout').innerHTML = `Ø ${cm.toFixed(1)} cm · ${(cm / 2.54).toFixed(2)}″<small>Girth ${gcm.toFixed(1)} cm · ${(gcm / 2.54).toFixed(1)}″</small>`;
    this._$('.sr').textContent = `Diameter ${cm.toFixed(1)} centimetres, ${(cm / 2.54).toFixed(2)} inches`;
    this._dirty = true;
  }

  _placeReadout() {
    const sec = this._sec, el = this._$('.readout'); if (!sec) return;
    const R = sec.diameter / 2 + 0.006, cam = this._camera;
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const p = new Vector3(...sec.centre).addScaledVector(right, R + 0.012).project(cam);
    const st = this._$('.stage'), W = st.clientWidth, H = st.clientHeight;
    const x = Math.min(W - el.offsetWidth - 8, Math.max(8, (p.x * 0.5 + 0.5) * W)), y = Math.min(H - 24, Math.max(24, (-p.y * 0.5 + 0.5) * H));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  _bindGaugeDrag() {
    const cv = this._renderer.domElement, wrap = this._$('.wrap');
    const ndc = (e) => { const r = cv.getBoundingClientRect(); return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const onRing = (e) => { this._ray.setFromCamera(ndc(e), this._camera); return this._ray.intersectObject(this._ringHit, false).length > 0; };
    const heightAt = (e) => {
      // where the pointer meets an upright plane through the toy, facing the camera
      this._ray.setFromCamera(ndc(e), this._camera);
      const f = new Vector3(); this._camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
      const hit = new Vector3(); if (!this._ray.ray.intersectPlane(new Plane(f.negate(), 0), hit)) return null;
      return hit.y;
    };
    // grab the ring itself or its measurement label, then slide up and down
    let drag = null, el = null;
    const start = (e, target) => { drag = e.pointerId; el = target; this._controls.enabled = false; target.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); };
    wrap.addEventListener('pointerdown', (e) => { if (this._state.gauge && e.target === cv && onRing(e)) start(e, cv); }, true);
    const label = this._$('.readout');
    label.addEventListener('pointerdown', (e) => { if (this._state.gauge) start(e, label); });
    const move = (e) => {
      if (!this._state.gauge) return;
      if (drag === null) { if (e.currentTarget === cv) cv.style.cursor = onRing(e) ? 'ns-resize' : ''; return; }
      if (e.pointerId !== drag) return;
      const y = heightAt(e); const S = this._sections(); if (y === null || !S.length) return;
      let best = 0; S.forEach((s, i) => { if (Math.abs(s.y - y) < Math.abs(S[best].y - y)) best = i; });
      this._moveGauge(best / (S.length - 1));
    };
    const end = (e) => { if (drag === null || e.pointerId !== drag) return; drag = null; el = null; this._controls.enabled = true; };
    for (const t of [cv, label]) { t.addEventListener('pointermove', move); t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end); }
  }

  _loadManifest() {
    const model = (this.getAttribute('model') || '').trim().toLowerCase();
    if (this._loading && this._loadingModel === model) return this._loading;
    this._loadingModel = model;
    this._loading = this._doLoadManifest(model);
    return this._loading;
  }

  async _doLoadManifest(model) {
    if (!/^[a-z0-9-]+$/.test(model)) throw new Error('Missing or invalid model attribute');
    this._modelBase = this._assets + model + '/';
    this._manifest = await download(this._modelBase + 'manifest.json', 'json'); this._cache = {};
    const m = this._manifest;
    const sizes = this._$('.sizes');
    const uniqueSizes = m.sizes.filter((s, i) => m.sizes.findIndex((t) => t.id === s.id) === i);   // one button per size, whatever bases it has
    sizes.innerHTML = uniqueSizes.map((s) => `<button class="size" data-s="${s.id}" aria-pressed="false">${s.label}${s.chart && s.chart.lengthCm ? `<small>${s.chart.lengthCm} cm · ${(s.chart.lengthCm / 2.54).toFixed(1)}″</small>` : ''}</button>`).join('');
    sizes.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => this._selectSize(b.dataset.s)));
    const bases = this._$('.bases');
    const multiBase = (m.bases || []).length > 1;
    bases.hidden = !multiBase;
    bases.innerHTML = multiBase ? m.bases.map((b) => `<button class="chip" data-b="${b.id}" aria-pressed="false">${b.label}</button>`).join('') : '';
    bases.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => this._selectBase(b.dataset.b)));
    const want = this.getAttribute('size') || m.defaultSize || m.sizes[0].id;
    await this._selectSize(want);
  }

  _variant(sizeId, baseId) {
    const list = this._manifest.sizes;
    return list.find((s) => s.id === sizeId && (!baseId || s.base === baseId)) || list.find((s) => s.id === sizeId) || list[0];
  }

  async _selectSize(sizeId) { return this._show(this._variant(sizeId, this._baseId)); }
  async _selectBase(baseId) { this._baseId = baseId; return this._show(this._variant(this._current ? this._current.id : null, baseId)); }

  async _show(v) {
    const key = v.model; const st = this._$('.status');
    if (!this._cache[key]) {
      st.hidden = false; st.textContent = 'Loading 3D model…';
      this._cache[key] = await decodeKkm((await download(this._modelBase + v.model, 'bin')).slice(0), this._manifest.color || '#7A48E8');
      this._cache[key].material.clippingPlanes = [this._cutPlane]; this._cache[key].material.clipShadows = true;
    }
    st.hidden = true;
    const mesh = this._cache[key]; this._current = v; this._baseId = v.base;
    this._toy.clear(); this._toy.add(mesh);
    new Box3().setFromObject(mesh).getSize(this._size3);
    this._buildCut(mesh); this._buildExtras(); if (this._state.cut) this._setCut(true, true);
    if (this._state.gauge) this._moveGauge(this._gaugeAt);
    if (!this._framed) { this._frame(); this._framed = true; } else this._dirty = true;
    this._root.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === v.id)));
    const here = this._manifest.sizes.filter((s) => s.id === v.id).map((s) => s.base);   // bases this size comes with
    this._root.querySelectorAll('[data-b]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.b === v.base)); b.hidden = !here.includes(b.dataset.b); });
    this._$('.bases').hidden = here.length < 2;
    this._prepareAR(v);
    this.dispatchEvent(new CustomEvent('kk-size', { detail: { size: v.id, base: v.base }, bubbles: true, composed: true }));
  }

  _frame() {
    const s = this._size3, h = s.y, r = Math.max(s.x, s.z) / 2, cam = this._camera;
    const extra = (this._state.ruler ? 0.06 : 0) + (this._state.can !== 'none' ? 0.09 : 0);
    const labels = this._state.ruler || this._state.can !== 'none';
    this._controls.target.set(0, h * (labels ? 0.54 : 0.5), 0);
    const t = Math.tan((cam.fov * Math.PI) / 360);
    const d = Math.max((h * (labels ? 0.78 : 0.66)) / t, ((r + 0.03 + extra) * 1.3) / (t * cam.aspect));
    cam.position.set(d * 0.5, h * 0.62, d * 0.86); this._controls.update(); this._dirty = true;
  }

  _viewBase() {
    const c = this._controls, d = Math.max(0.42, this._camera.position.distanceTo(c.target));
    c.target.set(0, this._size3.y * 0.25, 0); this._camera.position.set(d * 0.25, -d * 0.82, d * 0.38); c.update(); this._dirty = true;
  }

  _buildCut(mesh) {
    this._cutGroup.clear(); mesh.updateMatrixWorld(true);
    const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, clippingPlanes: [this._cutPlane] };
    const back = new MeshBasicMaterial({ ...base, side: BackSide, stencilFail: IncrementWrapStencilOp, stencilZFail: IncrementWrapStencilOp, stencilZPass: IncrementWrapStencilOp });
    const front = new MeshBasicMaterial({ ...base, side: FrontSide, stencilFail: DecrementWrapStencilOp, stencilZFail: DecrementWrapStencilOp, stencilZPass: DecrementWrapStencilOp });
    const a = new Mesh(mesh.geometry, back), b = new Mesh(mesh.geometry, front);
    a.renderOrder = b.renderOrder = 1;
    for (const m of [a, b]) { m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld); }
    this._cutGroup.add(a, b); this._cutGroup.visible = this._state.cut;
  }

  _setCut(on, instant) {
    this._state.cut = on; this._cutGroup.visible = on; this._cap.visible = on; this._cap.position.y = this._size3.y / 2;
    const p = this._cutPlane, far = this._size3.x / 2 + 0.01, from = p.constant > 1 ? far : p.constant, to = on ? 0 : far;
    const t0 = performance.now(), id = (this._cutId = (this._cutId || 0) + 1);
    this._anim = true;
    const step = () => {
      if (id !== this._cutId) return;
      const k = instant ? 1 : Math.min(1, (performance.now() - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      p.constant = from + (to - from) * e; this._cap.position.x = p.constant; this._dirty = true;
      if (k < 1) requestAnimationFrame(step); else { if (!on) p.constant = 10; this._anim = false; this._dirty = true; }
    };
    step();
    if (on && !instant) {
      const c = this._controls, d = this._camera.position.distanceTo(c.target);
      c.target.set(0, this._size3.y * 0.5, 0); this._camera.position.set(d * 0.92, this._size3.y * 0.58, d * 0.38); c.update();
    }
  }

  _label(text, scale) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d');
    g.font = '700 54px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.fillText(text, 128, 50);
    const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(cv), depthTest: false, transparent: true }));
    s.scale.set(scale * 2.66, scale, 1); s.renderOrder = 10; return s;
  }

  _can(spec) {
    const { h, r } = spec;
    const pts = [[0, 0], [r * 0.82, 0], [r, 0.006], [r, h - 0.016], [r * 0.8, h - 0.003], [r * 0.8, h], [r * 0.74, h - 0.004], [0, h - 0.004]].map((p) => new Vector2(p[0], p[1]));
    const m = new Mesh(new LatheGeometry(pts, 48), new MeshStandardMaterial({ color: spec.color, roughness: 0.3, metalness: 0.35 }));
    m.castShadow = true; return m;
  }

  _loadRef(id) {
    this._refLoads = this._refLoads || {};
    if (this._refLoads[id]) return;
    this._refLoads[id] = download(this._assets + '_refs/' + id + '.kkm', 'bin')
      .then((b) => decodeKkm(b.slice(0), CANS[id].color))
      .then((m) => {
        m.material.metalness = 0.45; m.material.roughness = 0.32; m.renderOrder = 0; m.position.set(0, 0, 0);
        this._refs[id] = m; if (this._state.can === id) this._buildExtras();
      })
      .catch((e) => console.warn('[kk-toy-viewer] can model', e));
  }

  _buildExtras() {
    const ex = this._extras; ex.clear();
    const h = this._size3.y, off = Math.max(this._size3.x, this._size3.z) / 2 + 0.03;
    if (this._state.ruler) {
      const pts = [], x = -off, xr = off;
      pts.push(x, 0, 0, x, h, 0);
      for (let cm = 0; cm <= Math.floor(h * 100); cm++) { const w = cm % 5 === 0 ? 0.014 : 0.007; pts.push(x, cm / 100, 0, x - w, cm / 100, 0); }
      pts.push(x, h, 0, x - 0.014, h, 0, xr, 0, 0, xr, h, 0);
      for (let q = 0; q <= Math.floor(h / 0.00635); q++) { const y = q * 0.00635, w = q % 4 === 0 ? 0.014 : 0.006; pts.push(xr, y, 0, xr + w, y, 0); }
      pts.push(xr, h, 0, xr + 0.014, h, 0);
      const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      ex.add(new LineSegments(g, new LineBasicMaterial({ color: 0xffffff })));
      for (let cm = 5; cm < h * 100 - 2; cm += 5) { const l = this._label(String(cm), 0.02); l.position.set(x - 0.032, cm / 100, 0); ex.add(l); }
      for (let i = 2; i * 0.0254 < h - 0.015; i += 2) { const l = this._label(String(i), 0.02); l.position.set(xr + 0.032, i * 0.0254, 0); ex.add(l); }
      const a = this._label((h * 100).toFixed(1) + ' cm', 0.03); a.position.set(x - 0.03, h + 0.024, 0); ex.add(a);
      const b = this._label((h / 0.0254).toFixed(1) + ' in', 0.03); b.position.set(xr + 0.03, h + 0.024, 0); ex.add(b);
    }
    if (this._state.can !== 'none') {
      const id = this._state.can, spec = CANS[id], cx = off + (this._state.ruler ? 0.09 : 0.045);
      // real can models (models/_refs/*.kkm); a simple drawn can stands in while one downloads or if it fails
      let cn = this._refs[id], ch = spec.h;
      if (cn) ch = new Box3().setFromObject(cn).getSize(new Vector3()).y;
      else { cn = this._can(spec); this._loadRef(id); }
      cn.position.set(cx, 0, 0.01); ex.add(cn);
      const l = this._label((ch * 100).toFixed(1) + ' cm', 0.024); l.position.set(cx, ch + 0.02, 0.01); ex.add(l);
    }
    this._dirty = true;
  }

  // ---- augmented reality (phones): Quick Look on iPhone, Scene Viewer / WebXR on Android ----
  async _prepareAR(v) {
    const btn = this._$('.ar');
    this._$('.note').hidden = true;
    if (!v.ar) { btn.hidden = true; return; }
    btn.hidden = false;
    // Phones only: the AR library (~300 KB) loads once the toy is on screen and the page is idle.
    const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!phone) return;
    const src = this._modelBase + v.ar;
    await new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 2500 }) : setTimeout(ok, 800)));
    try {
      await loadModelViewer();
      let mv = this._mv;
      if (!mv) {
        mv = document.createElement('model-viewer');
        mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
        mv.setAttribute('ar-scale', 'fixed'); mv.setAttribute('ar-placement', 'floor'); mv.setAttribute('loading', 'eager');
        mv.setAttribute('alt', (this._manifest.name || 'Toy') + ' in augmented reality');
        this._$('.mv').appendChild(mv); this._mv = mv;
      }
      if (mv.getAttribute('src') !== src) mv.setAttribute('src', src);
    } catch (e) {
      console.warn('[kk-toy-viewer] AR unavailable', e);
    }
  }

  _openAR() {
    const note = this._$('.note');
    if (this._mv && this._mv.canActivateAR) { this._mv.activateAR(); return; }
    const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    note.textContent = phone ? 'AR is still loading, or this phone doesn’t support it. Try again in a moment.' : 'Open this page on your phone to see the toy at real size in your room.';
    note.hidden = false; clearTimeout(this._noteT); this._noteT = setTimeout(() => { note.hidden = true; }, 5000);
  }
}

if (!customElements.get('kk-toy-viewer')) customElements.define('kk-toy-viewer', KKToyViewer);
