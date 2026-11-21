// Kinky Kreatures 3D toy viewer — a Wix custom element.
// Usage on a page: <kk-toy-viewer model="kraken"></kk-toy-viewer>
// Optional attributes: size="large", assets="https://.../models/" (override where models load from).
import {
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, DirectionalLight, Mesh, PlaneGeometry, ShadowMaterial,
  Group, Box3, Vector3, Vector2, Plane, MeshStandardMaterial, MeshBasicMaterial, BufferGeometry, BufferAttribute,
  Float32BufferAttribute, LineSegments, LineBasicMaterial, Sprite, SpriteMaterial, CanvasTexture, LatheGeometry, Texture,
  Color, ACESFilmicToneMapping, PCFShadowMap, NoColorSpace, ObjectSpaceNormalMap, BackSide, FrontSide,
  AlwaysStencilFunc, NotEqualStencilFunc, IncrementWrapStencilOp, DecrementWrapStencilOp, ReplaceStencilOp,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const VERSION = '__VERSION__';
const DEFAULT_ASSETS = 'https://cdn.jsdelivr.net/gh/AusFlexDesigns/kinky-kreatures-3d@' + VERSION + '/models/';
const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js';
const CANS = {
  soda: { label: 'Soda can 375 ml', h: 0.115, r: 0.033, color: 0xc8202a },
  monster: { label: 'Monster can 500 ml', h: 0.168, r: 0.033, color: 0x2a2a2a },
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

let modelViewerPromise = null;
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

const ICON = {
  ruler: '<path d="M8 3h8v18H8z"/><path d="M8 7h4M8 11h3M8 15h4M8 19h3"/>',
  soda: '<path d="M8 5h8l1 2v12l-1 2H8l-1-2V7z"/><path d="M9 3h6"/>',
  monster: '<path d="M8.5 2.5h7l1 2v15l-1 2h-7l-1-2v-15z"/><path d="M10 9l1.2 6L12 11l.8 4L14 9"/>',
  cut: '<path d="M10 3c-2 3-3 6-3 10s1 6 3 8z"/><path d="M14 3c2 3 3 6 3 10s-1 6-3 8z"/><path d="M4 12h2M18 12h2"/>',
  base: '<ellipse cx="12" cy="16" rx="8" ry="3.5"/><path d="M8 15V8c0-2 2-5 4-5s4 3 4 5v7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
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
.chip{min-height:40px;padding:0 14px;border-radius:999px;border:1.5px solid rgba(255,255,255,.28);background:rgba(21,10,51,.55);font-size:13px;font-weight:700}
.chip[aria-pressed="true"]{background:#fff;color:#150a33;border-color:#fff}
.ar{position:absolute;right:16px;top:16px;z-index:2;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 16px;border-radius:999px;border:0;background:#fff;color:#150a33;font-size:14px;font-weight:800;letter-spacing:.04em}
.ar svg{width:22px;height:22px}
.ar[hidden]{display:none}
.note{position:absolute;right:16px;top:72px;z-index:3;max-width:240px;margin:0;padding:10px 12px;border-radius:12px;background:#fff;color:#150a33;font-size:13px;line-height:1.4;font-weight:600}
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
}`;

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
  </div>
  <div class="col views" role="group" aria-label="Views">
    <button class="icon" data-v="cut" aria-pressed="false" aria-label="Cutaway view" title="See inside">${svg('cut')}</button>
    <button class="icon" data-v="base" aria-label="View the base" title="View the base">${svg('base')}</button>
    <button class="icon" data-v="reset" aria-label="Reset view" title="Reset view">${svg('reset')}</button>
  </div>
  <div class="col sizes" role="group" aria-label="Size"></div>
  <div class="col bases" role="group" aria-label="Base"></div>
  <button class="ar" hidden>${svg('ar')}View in your space</button>
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

    this._size3 = new Vector3(0.1, 0.3, 0.1);
    this._state = { ruler: false, can: 'none', cut: false };
    this._cache = {};

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
      r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); this._dirty = true;
    };
    this._ro = new ResizeObserver(resize); this._ro.observe(stage); resize();
    r.setAnimationLoop(() => {
      if (!this._visible) return;
      const moved = c.update();
      if (moved || this._dirty || this._anim) { r.render(scene, cam); this._dirty = false; }
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
  }

  async _loadManifest() {
    const model = (this.getAttribute('model') || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(model)) throw new Error('Missing or invalid model attribute');
    this._modelBase = this._assets + model + '/';
    const res = await fetch(this._modelBase + 'manifest.json'); if (!res.ok) throw new Error('Manifest ' + res.status);
    this._manifest = await res.json(); this._cache = {};
    const m = this._manifest;
    const sizes = this._$('.sizes');
    sizes.innerHTML = m.sizes.map((s) => `<button class="size" data-s="${s.id}" aria-pressed="false">${s.label}${s.chart && s.chart.lengthCm ? `<small>${s.chart.lengthCm} cm · ${(s.chart.lengthCm / 2.54).toFixed(1)}″</small>` : ''}</button>`).join('');
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
      const res = await fetch(this._modelBase + v.model); if (!res.ok) throw new Error('Model ' + res.status);
      this._cache[key] = await decodeKkm(await res.arrayBuffer(), this._manifest.color || '#7A48E8');
      this._cache[key].material.clippingPlanes = [this._cutPlane]; this._cache[key].material.clipShadows = true;
    }
    st.hidden = true;
    const mesh = this._cache[key]; this._current = v; this._baseId = v.base;
    this._toy.clear(); this._toy.add(mesh);
    new Box3().setFromObject(mesh).getSize(this._size3);
    this._buildCut(mesh); this._buildExtras(); if (this._state.cut) this._setCut(true, true);
    if (!this._framed) { this._frame(); this._framed = true; } else this._dirty = true;
    this._root.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === v.id)));
    this._root.querySelectorAll('[data-b]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.b === v.base)));
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
      const spec = CANS[this._state.can], cx = off + (this._state.ruler ? 0.09 : 0.045);
      const cn = this._can(spec); cn.position.set(cx, 0, 0.01); ex.add(cn);
      const l = this._label((spec.h * 100).toFixed(1) + ' cm', 0.024); l.position.set(cx, spec.h + 0.02, 0.01); ex.add(l);
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
