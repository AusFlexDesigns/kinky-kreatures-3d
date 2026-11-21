// Kinky Kreatures product page — a Wix custom element.
// Usage: <kk-product-page slug="kraken-the-tentacle"></kk-product-page>
// The page code (Velo) passes the store product in as JSON on the `product` attribute and listens for
// `kk-add-to-cart`, answering on the `cart-status` attribute. Everything is drawn in the light DOM
// (not a shadow root) so search engines read the product name, description and sections as page text.
import qrcode from 'qrcode-generator';

const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'main';
const BASE = /\/dist\/kk-product(\.min)?\.js(\?.*)?$/.test(SCRIPT_SRC)
  ? SCRIPT_SRC.replace(/dist\/kk-product(\.min)?\.js(\?.*)?$/, '')
  : 'https://cdn.jsdelivr.net/gh/AusFlexDesigns/kinky-kreatures-3d@' + VERSION + '/';
const VIEWER_SRC = BASE + 'dist/kk-viewer.js';
const AU_MADE = 'https://static.wixstatic.com/media/50feb9_a60b1806a19e4adb9f56318e51970668~mv2.png/v1/crop/x_149,y_122,w_929,h_861/fill/w_96,h_89,al_c,q_85,enc_auto/australian-made.png';

// ---------- small helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (root, s) => root.querySelector(s);
const $$ = (root, s) => Array.from(root.querySelectorAll(s));
const money = (s) => String(s || '').replace(/\.00(?!\d)/, '');
const isPhone = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function wixImg(url, w, h, mode) {
  if (!url) return '';
  const m = /^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/.exec(url);
  if (!m) return url;
  const name = m[1].replace(/~mv2/, '').replace(/[^a-zA-Z0-9._-]/g, '');
  return `https://static.wixstatic.com/media/${m[1]}/v1/${mode || 'fill'}/w_${w},h_${h},al_c,q_85,enc_auto/${name}`;
}
// Keep only simple formatting from store text (it is the shop's own content, but stay tidy and safe).
function cleanHTML(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const ok = new Set(['P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'A', 'SPAN', 'H3', 'H4']);
  const walk = (el) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 1) continue;
      walk(n);
      if (!ok.has(n.tagName)) { n.replaceWith(...n.childNodes); continue; }
      if (n.tagName === 'SPAN' && /font-weight:\s*(700|bold)/i.test(n.getAttribute('style') || '')) {
        const b = doc.createElement('strong'); b.append(...n.childNodes); n.replaceWith(b); continue;
      }
      if (n.tagName === 'SPAN') { n.replaceWith(...n.childNodes); continue; }
      const href = n.tagName === 'A' ? n.getAttribute('href') : null;
      for (const a of Array.from(n.attributes)) n.removeAttribute(a.name);
      if (href && /^(https?:|\/)/i.test(href)) n.setAttribute('href', href);
    }
  };
  const root = doc.body.firstChild; walk(root);
  // drop empty paragraphs the store editor leaves behind
  $$(root, 'p').forEach((p) => { if (!p.textContent.replace(/ |​/g, '').trim() && !p.querySelector('br,a')) p.remove(); });
  return root.innerHTML;
}

// ---------- icons ----------
const ICON = {
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12"/><path d="M21 7l-9 5-9-5"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  truck: '<rect x="2" y="7" width="12" height="10" rx="1"/><path d="M14 10h4l3 3v4h-7"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
  bases: '<rect x="3" y="15" width="18" height="5" rx="2"/><path d="M8 15V6a4 4 0 0 1 8 0v9"/>',
};
const icon = (k, size = 20) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const FEATURE_ICON = {
  tentacle: '<svg aria-hidden="true" width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="#C9B4FF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 30L13.6 27.7L13.4 25.6L13.4 23.6L13.6 21.9L14 20.3L14.7 18.8L15.8 17.4L17.3 15.9L18.9 14.4L20.3 13L21.5 11.6L22.5 10.2L23.3 8.7L23.6 7L23.5 5.2L22.8 3.5L21.7 2.3L20.3 1.8L18.9 1.7L17.6 2.2L16.6 3.3L16.2 4.7L16.5 6L17 6.7L17.8 7.1L18.5 7.2L19.2 7L19.7 6.6L20 6L20 5.3L19.5 5.5L19.4 5.9L19.1 6.1L18.8 6.1L18.5 6L18.2 5.9L18.1 5.6L18 5.3L18.1 4.7L18.4 4.3L18.8 4.1L19.2 4.1L19.7 4.3L20.1 4.6L20.3 5.1L20.4 5.9L20.3 6.8L19.9 7.5L19.3 8.3L18.4 9.2L17.2 10.3L15.6 11.5L13.9 12.9L12 14.6L10.3 16.6L9.1 18.8L8.3 21.2L7.8 23.7L7.7 26.2L7.7 28.9L7.9 30.9Z"/><circle cx="10.3" cy="27.3" r="1.5"/><circle cx="10.8" cy="21.2" r="1.4"/><circle cx="13.5" cy="16" r="1.2"/><circle cx="18.1" cy="12" r="1.1"/><circle cx="21" cy="8.8" r="0.9"/><circle cx="21.8" cy="5.5" r="0.8"/></svg>',
  hexagon: '<svg aria-hidden="true" width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="#C9B4FF" stroke-width="1.6" stroke-linejoin="round"><polygon points="9.2,4.3 22.7,4.3 29.5,16 22.7,27.6 9.2,27.6 2.5,16"/><path d="M16 16L9.2 4.3M16 16L22.7 4.3M16 16L29.5 16M16 16L22.7 27.6M16 16L9.2 27.6M16 16L2.5 16" stroke-width="0.9" opacity="0.6"/><polygon points="12.6,10.1 19.3,10.1 22.7,16 19.3,21.8 12.6,21.8 9.2,16" stroke-width="0.9" opacity="0.6"/><polygon points="9.2,4.3 19,10.7 25.7,16 17.8,19.2 11.4,23.9 11.6,16" fill="#FF7AB6" fill-opacity="0.5" stroke="#FF7AB6"/></svg>',
  bases: `<svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#C9B4FF" stroke-width="2" stroke-linecap="round">${ICON.bases}</svg>`,
  aumade: `<img src="${AU_MADE}" alt="Australian Made logo" width="52" height="48" loading="lazy">`,
};

// ---------- the colour chart (shared by every listing) ----------
const COLOURS = {
  Solid: [['Semi Translucent', 'Semi Translucent', '#C9CDD6', 'trans'], ['Black', 'Black', '#231F20'], ['White', 'White', '#FEFFFF'], ['Violet', 'Violet', '#6F21FD'], ['Purple', 'Purple', '#8A00F8'], ['Fuchsia', 'Fuchsia', '#CE4EFE'], ['Red', 'Red', '#FE3A3D'], ['Pink', 'Pink', '#F9298F'], ['Blue', 'Blue', '#201CFE'], ['Turquoise', 'Turquoise', '#1D94FC'], ['Green', 'Green', '#40E240'], ['Brilliant Green', 'Brilliant Green', '#30FEE1'], ['Yellow', 'Yellow', '#FEFE13'], ['Orange', 'Orange', '#FCAB01'], ['Silver Grey', 'Silver Grey', '#7F8386']],
  Glitter: [['Glitter Black', 'Black', '#191723'], ['Glitter White', 'White', '#E8DBD3'], ['Glitter Silver', 'Silver', '#979296'], ['Glitter Red', 'Red', '#AB2530'], ['Glitter Blue', 'Blue', '#142F9A'], ['Glitter Aqua', 'Aqua', '#1A6372'], ['Glitter Purple', 'Purple', '#9E2F96'], ['Glitter Hot Pink', 'Hot Pink', '#941E58'], ['Glitter Bright Pink', 'Bright Pink', '#E14497'], ['Glitter Gold', 'Gold', '#C6A627'], ['Glitter Neon Pink', 'Neon Pink', '#B10C6E'], ['Glitter Neon Yellow', 'Neon Yellow', '#DFE503'], ['Glitter Neon Orange', 'Neon Orange', '#F18004'], ['Glitter Neon Green', 'Neon Green', '#89B225'], ['Glitter Neon Purple', 'Neon Purple', '#77539E']],
  Fluorescent: [['Fluorescent Pink', 'Pink', '#F05497'], ['Fluorescent Yellow', 'Yellow', '#F9F25C'], ['Fluorescent Orange', 'Orange', '#FBA748'], ['Fluorescent Green', 'Green', '#A1DD33'], ['Fluorescent Blue', 'Blue', '#34D0EF']],
  'UV · glow in the dark': [['UV Pink', 'Pink', '#FE447E'], ['UV Yellow', 'Yellow', '#D5E020'], ['UV Orange', 'Orange', '#F6941E'], ['UV Green', 'Green', '#89D600'], ['UV Blue', 'Blue', '#00AFF0']],
};
const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };

// ---------- styles (scoped to .kkp; overlays use .kkp-ov) ----------
const CSS = `
.kkp,.kkp-ov{--ink:#060506;--card:#0F0A1C;--card2:#160E2A;--line:rgba(159,125,232,.24);--line2:rgba(159,125,232,.45);--lav:#C9B4FF;--soft:#C8BFDB;--soft2:#B9B0CC;--text:#E4DDF3;--btn:#8858ED;--pink:#FF9CC8;
  font-family:Assistant,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased}
.kkp *,.kkp-ov *{box-sizing:border-box}
.kkp{display:block;background:var(--ink);container:kkp/inline-size}
.kkp-in{max-width:1280px;margin:0 auto;padding:28px 40px 72px}
.kkp h1,.kkp h2,.kkp h3,.kkp-ov h2{font-family:Montserrat,"Helvetica Neue",Arial,sans-serif;margin:0;color:#fff}
.kkp p{margin:0}
.kkp a{color:var(--lav)}.kkp a:hover{color:#fff}
.kkp button{font:inherit;color:inherit;cursor:pointer}
.kkp button:focus-visible,.kkp a:focus-visible,.kkp input:focus-visible,.kkp-ov button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.kkp-mont{font-family:Montserrat,"Helvetica Neue",Arial,sans-serif}
.kkp-crumbs{font-size:14px;color:var(--soft2);margin-bottom:18px}.kkp-crumbs a{color:var(--soft2);text-decoration:none}.kkp-crumbs a:hover{color:#fff}
.kkp-hero{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);grid-template-areas:"stage buy" "photos buy";gap:14px 40px;align-items:start}
.kkp-stage{grid-area:stage;position:relative;height:640px;border-radius:24px;overflow:hidden;background:radial-gradient(ellipse at 50% 38%,#4B23A1 0%,#23104A 55%,#120A22 100%);border:1px solid var(--line)}
.kkp-stage kk-toy-viewer{position:absolute;inset:0;width:100%;height:100%;--kk-bg:transparent;--kk-accent:#FF5FA2}
.kkp-stage>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.kkp-pill{position:absolute;top:16px;left:16px;z-index:3;font:700 12px/1 Montserrat,Arial,sans-serif;letter-spacing:1.5px;padding:10px 14px;border-radius:999px;background:rgba(6,5,6,.55);pointer-events:none}
.kkp-stage-ar{position:absolute;top:14px;right:14px;z-index:3;display:flex;align-items:center;gap:8px;font:700 13px/1 Montserrat,Arial,sans-serif;letter-spacing:.6px;padding:11px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(6,5,6,.5);color:#fff}
.kkp-stage-ar:hover{background:rgba(6,5,6,.75)}
.kkp-arprompt{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:4;display:flex;align-items:center;gap:10px;padding:14px 20px;border-radius:999px;border:0;background:#fff;color:#0B0614;font:800 14px/1.1 Montserrat,Arial,sans-serif;letter-spacing:.8px;box-shadow:0 10px 30px rgba(0,0,0,.5);white-space:nowrap}
.kkp-photos{grid-area:photos;display:flex;flex-direction:column;gap:10px;margin-top:4px}
.kkp-rowhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.kkp-rowhead h2{font-size:22px;font-weight:900;letter-spacing:.5px}
.kkp-rowhead p{font-size:14px;color:var(--soft2)}
.kkp-car{position:relative}
.kkp-car-vp{overflow:hidden;border-radius:16px}
.kkp-car-track{display:flex;gap:12px;transition:transform .35s ease}
.kkp-tile{flex:0 0 calc((100% - 36px)/4);height:200px;padding:0;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#120A22;cursor:zoom-in;position:relative}
.kkp-tile img{width:100%;height:100%;object-fit:cover;display:block}
.kkp-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.4);background:rgba(6,5,6,.8);display:flex;align-items:center;justify-content:center;color:#fff}
.kkp-arrow[disabled]{opacity:.3;cursor:default}
.kkp-arrow.l{left:-14px}.kkp-arrow.r{right:-14px}
.kkp-buy{grid-area:buy;grid-row:1/span 2;position:sticky;top:24px;display:flex;flex-direction:column;gap:22px;padding:30px;border-radius:24px;background:var(--card);border:1px solid var(--line)}
.kkp-title{position:relative;display:flex;flex-direction:column;gap:6px;padding-right:150px;min-height:100px}
.kkp-title.nochar{padding-right:0;min-height:0}
.kkp-eyebrow{font:700 12px/1.3 Montserrat,Arial,sans-serif;letter-spacing:2px;color:var(--lav)}
.kkp h1{font-size:56px;font-weight:900;line-height:1;letter-spacing:1px;text-transform:uppercase}
.kkp h1 .kkp-h1sub{display:block;margin-top:8px;font-size:20px;font-weight:600;letter-spacing:0;text-transform:none;color:#D9CFF2}
.kkp-char{position:absolute;top:-6px;right:-8px;width:150px;height:auto;pointer-events:none}
.kkp-price{font:800 36px/1.1 Montserrat,Arial,sans-serif}.kkp-price small{font-size:16px;font-weight:600;color:var(--soft2)}
.kkp-price s{font-size:20px;color:var(--soft2);font-weight:600;margin-left:8px}
.kkp-pay{font-size:14px;color:var(--soft2);margin-top:4px}
.kkp-hook{color:var(--text)}
.kkp-opt{border:0;margin:0;padding:0;min-width:0}
.kkp-opt legend{display:flex;justify-content:space-between;gap:10px;width:100%;padding:0;margin-bottom:10px;font:800 13px/1.3 Montserrat,Arial,sans-serif;letter-spacing:1.5px}
.kkp-opt legend span+span{font-family:Assistant,Arial,sans-serif;font-weight:600;letter-spacing:0;color:var(--lav)}
.kkp-chips{display:grid;grid-template-columns:repeat(var(--cols,4),minmax(0,1fr));gap:8px}
.kkp-chip{min-height:58px;padding:10px 8px;border-radius:12px;border:2px solid rgba(159,125,232,.35);background:transparent;color:#fff;text-align:center}
.kkp-chip.wide{text-align:left;padding:12px 14px}
.kkp-chip b{display:block;font:800 13px/1.25 Montserrat,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}
.kkp-chip span{display:block;font-size:12.5px;opacity:.8;margin-top:2px}
.kkp-chip[aria-pressed="true"]{background:#fff;border-color:#fff;color:#0B0614}
.kkp-chip.na{opacity:.45}
.kkp-fixed{font-size:14px;color:var(--soft)}
.kkp-col{position:relative;display:flex;flex-direction:column;gap:8px}
.kkp-col-head{display:flex;justify-content:space-between;align-items:baseline}
.kkp-col-head label{font:800 13px/1.3 Montserrat,Arial,sans-serif;letter-spacing:1.5px}
.kkp-col-head span{font-size:13px;color:var(--lav)}
.kkp-field{position:relative}
.kkp-field input{width:100%;font:16px Assistant,Arial,sans-serif;padding:13px 44px 13px 14px;border-radius:12px;border:1px solid var(--line2);background:var(--ink);color:#fff}
.kkp-field input::placeholder{color:#8F86A6}
.kkp-field svg{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--lav);pointer-events:none}
.kkp-hint{font-size:13px;color:var(--soft2)}
.kkp-picker{position:absolute;left:-14px;right:-14px;top:calc(100% - 26px);z-index:30;padding:18px;border-radius:18px;background:var(--card2);border:1px solid rgba(201,180,255,.5);box-shadow:0 24px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.kkp-picker[hidden]{display:none}
.kkp-pk-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.kkp-pk-head p{font:800 13px/1.2 Montserrat,Arial,sans-serif;letter-spacing:1.2px}
.kkp-count{font:800 12px/1 Montserrat,Arial,sans-serif;padding:6px 10px;border-radius:999px;background:rgba(159,125,232,.25)}
.kkp-count.full{background:#fff;color:#0B0614}
.kkp-ghost{font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid var(--line2);background:transparent}
.kkp-grp{font:700 11px/1.2 Montserrat,Arial,sans-serif;letter-spacing:1.5px;color:var(--soft2);text-transform:uppercase}
.kkp-sw{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px 4px}
.kkp-sw button{display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0;border:0;background:transparent;color:var(--text);font-size:10px;line-height:1.15;text-align:center}
.kkp-sw button[aria-disabled="true"]{opacity:.35}
.kkp-sw i{width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center}
.kkp-sw button[aria-pressed="true"] i{box-shadow:0 0 0 3px var(--card2),0 0 0 5px #fff}
.kkp-sw .glitter{background-image:radial-gradient(rgba(255,255,255,.75) .8px,transparent 1.4px),radial-gradient(rgba(255,255,255,.45) .8px,transparent 1.4px),radial-gradient(rgba(0,0,0,.25) 1px,transparent 1.6px);background-size:7px 7px,11px 11px,9px 9px;background-position:0 0,4px 6px,2px 3px}
.kkp-sw .trans{background-image:radial-gradient(circle at 30% 25%,rgba(255,255,255,.85) 0%,rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.7) 0%,rgba(236,238,244,.45) 45%,rgba(200,205,216,.55) 100%),linear-gradient(45deg,rgba(60,50,90,.22) 25%,transparent 25%,transparent 75%,rgba(60,50,90,.22) 75%),linear-gradient(45deg,rgba(60,50,90,.22) 25%,transparent 25%,transparent 75%,rgba(60,50,90,.22) 75%);background-size:100% 100%,100% 100%,10px 10px,10px 10px;background-position:0 0,0 0,0 0,5px 5px}
.kkp-pk-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kkp-pk-two .kkp-sw{grid-template-columns:repeat(5,minmax(0,1fr))}
.kkp-pk-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:10px;border-top:1px solid var(--line)}
.kkp-pk-foot p{font-size:12px;color:var(--soft2)}
.kkp-primary{height:44px;padding:0 20px;border-radius:999px;border:0;background:var(--btn);font:800 13px/1 Montserrat,Arial,sans-serif;letter-spacing:1px}
.kkp-cart{display:flex;flex-direction:column;gap:8px}
.kkp-cartrow{display:flex;gap:10px;align-items:stretch}
.kkp-qty{display:flex;align-items:center;border:1px solid var(--line2);border-radius:14px}
.kkp-qty button{width:44px;height:54px;border:0;background:transparent;font-size:20px}
.kkp-qty output{min-width:24px;text-align:center;font-weight:700}
.kkp-add{flex:1;height:56px;border-radius:14px;border:0;background:var(--btn);font:800 16px/1 Montserrat,Arial,sans-serif;letter-spacing:1px}
.kkp-add:hover{filter:brightness(1.1)}.kkp-add[disabled]{opacity:.7;cursor:progress}
.kkp-msg{font-size:14px;color:var(--pink)}.kkp-msg.ok{color:#9EF0B5}.kkp-msg:empty{display:none}
.kkp-trust{list-style:none;margin:0;padding:18px 0 0;border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;font-size:14px;color:var(--text)}
.kkp-trust li{display:flex;gap:10px;align-items:center}.kkp-trust svg{color:var(--lav);flex:0 0 auto}.kkp-trust img{width:32px;height:30px;flex:0 0 auto}
.kkp-sec{margin-top:40px}
.kkp-sec>h2,.kkp-h2{font-size:34px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;margin-bottom:24px}
.kkp-feat{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.kkp-card{padding:26px;border-radius:20px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
.kkp-card h3{font-size:18px;font-weight:800}
.kkp-card p,.kkp-card li{color:var(--soft);font-size:15px}
.kkp-about{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.kkp-rich{color:var(--text)}.kkp-rich p{margin:0 0 12px}.kkp-rich ul{margin:0 0 12px;padding-left:20px}.kkp-rich li{margin:4px 0}.kkp-rich li p{margin:0}.kkp-rich strong{color:#fff}
.kkp-fit{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:40px;align-items:stretch}
.kkp-lineup{display:flex;flex-direction:column;justify-content:flex-end;padding:16px 20px 12px;border-radius:24px;background:radial-gradient(ellipse at 50% 100%,#23104A 0%,#0F0A1C 70%);border:1px solid var(--line);--lh:390px}
.kkp-lu-row{position:relative;display:flex;align-items:flex-end;justify-content:space-between;padding:0 6px}
.kkp-lu-row:before{content:"";position:absolute;left:0;right:0;bottom:34px;height:1px;background:rgba(159,125,232,.35)}
.kkp-lu{display:flex;flex-direction:column;align-items:center;flex:0 0 calc(var(--lh)*var(--w))}
.kkp-lu img{display:block;height:calc(var(--lh)*var(--r));width:calc(var(--lh)*var(--w));max-width:none}
.kkp-lu .can{width:calc(var(--lh)*.17);height:calc(var(--lh)*.326);border-radius:12px;border:2px dashed rgba(200,191,219,.6)}
.kkp-lu b{height:34px;display:flex;align-items:center;font:800 13px/1 Montserrat,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}
.kkp-lu.ref{flex:0 0 calc(var(--lh)*.185)}.kkp-lu.ref b{color:var(--soft2)}
.kkp-fit-side{display:flex;flex-direction:column;gap:18px}
.kkp-fit-side>h2{font-size:34px;font-weight:900;text-transform:uppercase}
.kkp-tablebox{overflow-x:auto;border-radius:16px;border:1px solid var(--line)}
.kkp table{width:100%;border-collapse:collapse;font-size:15px;text-align:left}
.kkp thead tr{background:#1A1030;font:700 12px/1.2 Montserrat,Arial,sans-serif;letter-spacing:1px}
.kkp th,.kkp td{padding:12px 14px}.kkp tbody tr{border-top:1px solid rgba(159,125,232,.18)}
.kkp tbody th{font:700 13px/1.2 Montserrat,Arial,sans-serif}
.kkp td small{display:block;color:var(--soft2);font-size:13px}
.kkp-ar{margin-top:28px;border-radius:24px;padding:36px 44px;background:radial-gradient(circle at 88% 15%,rgba(159,125,232,.55) 0%,rgba(159,125,232,0) 45%),linear-gradient(115deg,#4B23A1 0%,#23104A 58%,#120A22 100%);border:1px solid rgba(201,180,255,.45);display:flex;align-items:center;gap:40px;flex-wrap:wrap}
.kkp-phone{position:relative;width:132px;height:236px;flex:0 0 auto;border-radius:26px;border:3px solid #fff;background:linear-gradient(180deg,#3A2A55 0%,#2A1E3F 62%,#5B4A6E 62%,#4A3C5C 100%);overflow:hidden}
.kkp-phone:before{content:"";position:absolute;top:8px;left:50%;transform:translateX(-50%);width:36px;height:6px;border-radius:999px;background:#0B0614}
.kkp-phone img{position:absolute;left:50%;bottom:66px;transform:translateX(-50%);width:auto}
.kkp-phone i{position:absolute;left:22px;right:22px;top:150px;height:28px;border:2px dashed rgba(255,255,255,.7);border-radius:50%}
.kkp-phone b{position:absolute;left:0;right:0;bottom:14px;text-align:center;font:800 10px/1 Montserrat,Arial,sans-serif;letter-spacing:1px}
.kkp-ar-copy{flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:12px}
.kkp-ar-copy .kkp-eyebrow{color:var(--pink)}
.kkp-ar-copy h2{font-size:34px;font-weight:900;line-height:1.1;text-transform:uppercase}
.kkp-ar-copy>p{color:var(--text);max-width:560px}
.kkp-ar-sel{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:16px;background:rgba(6,5,6,.38);border:1px solid rgba(255,255,255,.22);max-width:560px}
.kkp-ar-sel p{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;font-size:13px;color:#D9CFF2}
.kkp-ar-sel strong{font:900 16px/1.2 Montserrat,Arial,sans-serif;letter-spacing:1px;color:#fff;text-transform:uppercase}
.kkp-ar-chips{display:flex;gap:6px;flex-wrap:wrap}
.kkp-ar-chips button{height:36px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.4);background:transparent;font:800 12px/1 Montserrat,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}
.kkp-ar-chips button[aria-pressed="true"]{background:#fff;color:#0B0614;border-color:#fff}
.kkp-ar-go{align-self:flex-start;display:flex;align-items:center;gap:10px;height:52px;padding:0 22px;border-radius:999px;border:0;background:#fff;color:#0B0614!important;font:800 14px/1 Montserrat,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}
.kkp-qrbox{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:10px}
.kkp-qr{width:150px;height:150px;border-radius:16px;background:#fff;padding:10px}.kkp-qr svg{width:100%;height:100%;display:block}
.kkp-qrbox p{max-width:170px;text-align:center;font-size:13px;color:var(--text)}
.kkp-cards{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:16px}
.kkp-cards .kkp-card h2{font-size:20px;font-weight:900;text-transform:uppercase}
.kkp-dets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:16px}
.kkp details{padding:20px 24px;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.kkp summary{cursor:pointer;font:800 14px/1.3 Montserrat,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}
.kkp details .kkp-rich{margin-top:12px;font-size:15px}
.kkp-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* ---- tablet / phone ---- */
@container kkp (max-width:960px){
  .kkp-in{padding:16px 16px 48px}
  .kkp-hero{grid-template-columns:minmax(0,1fr);grid-template-areas:"stage" "buy" "photos";gap:18px}
  .kkp-stage{height:440px;border-radius:18px;margin:0 -16px;border-left:0;border-right:0;border-radius:0}
  .kkp-buy{position:static;grid-row:auto;padding:0;background:none;border:0;gap:18px}
  .kkp-title{padding-right:104px;min-height:0}
  .kkp-char{width:96px;top:-8px;right:0}
  .kkp h1{font-size:44px}.kkp h1 .kkp-h1sub{font-size:17px}
  .kkp-price{font-size:30px}
  .kkp-chip{min-height:48px;padding:8px 4px}.kkp-chip b{font-size:12px;letter-spacing:.6px}.kkp-chip span{display:none}
  .kkp-chip.wide{text-align:center;padding:8px 6px}
  .kkp-picker{left:-6px;right:-6px;padding:14px}
  .kkp-sw{grid-template-columns:repeat(6,minmax(0,1fr))}
  .kkp-pk-two{grid-template-columns:1fr}
  .kkp-trust{grid-template-columns:repeat(2,minmax(0,1fr));font-size:13px;padding:14px 0;border-bottom:1px solid var(--line)}
  .kkp-tile{flex-basis:calc((100% - 8px)/2);height:190px}
  .kkp-car-track{gap:8px}
  .kkp-arrow.l{left:6px}.kkp-arrow.r{right:6px}
  .kkp-rowhead h2{font-size:16px}.kkp-rowhead p{font-size:12px}
  .kkp-sec{margin-top:32px}
  .kkp-sec>h2,.kkp-h2,.kkp-fit-side>h2{font-size:24px;margin-bottom:14px}
  .kkp-feat{grid-template-columns:minmax(0,1fr);gap:10px}
  .kkp-card{padding:18px;flex-direction:row;align-items:flex-start;gap:14px}
  .kkp-card>div{display:flex;flex-direction:column;gap:2px}
  .kkp-card h3{font-size:15px}.kkp-card p{font-size:14px}
  .kkp-fit{grid-template-columns:minmax(0,1fr);gap:16px}
  .kkp-lineup{--lh:175px;padding:12px 8px 8px;order:2}
  .kkp-lu b{font-size:10px;letter-spacing:.5px;height:28px}.kkp-lu-row:before{bottom:28px}
  .kkp table{font-size:14px}.kkp th,.kkp td{padding:9px 8px}
  .kkp-ar{padding:18px;gap:14px;border-radius:18px}
  .kkp-phone,.kkp-qrbox{display:none}
  .kkp-ar-copy h2{font-size:21px}
  .kkp-ar-chips{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
  .kkp-ar-chips button{padding:0 4px}
  .kkp-ar-go{align-self:stretch;justify-content:center;font-size:13px}
  .kkp-cards{grid-template-columns:minmax(0,1fr)!important}
  .kkp-cards .kkp-card{flex-direction:column}
  .kkp-dets{grid-template-columns:minmax(0,1fr)}
}
@container kkp (max-width:400px){
  .kkp h1{font-size:38px}
  .kkp-title{padding-right:88px}.kkp-char{width:84px}
  .kkp-chips{gap:6px}
  .kkp-trust{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){.kkp-car-track{transition:none}}
/* overlays */
.kkp-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(6,5,6,.94);display:flex;align-items:center;justify-content:center;padding:24px}
.kkp-ov button{font:inherit;color:#fff;cursor:pointer}
.kkp-ov-x{position:absolute;top:18px;right:18px;width:48px;height:48px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:transparent;display:flex;align-items:center;justify-content:center}
.kkp-lb{display:flex;align-items:center;gap:18px;max-width:100%}
.kkp-lb figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0}
.kkp-lb figure img{max-width:min(1000px,calc(100vw - 180px));max-height:68vh;border-radius:16px;display:block}
.kkp-lb figcaption{font-size:14px;color:#D9CFF2}
.kkp-lb-nav{flex:0 0 auto;width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(6,5,6,.5);display:flex;align-items:center;justify-content:center}
.kkp-thumbs{display:flex;gap:8px;max-width:calc(100vw - 48px);overflow-x:auto;padding:4px}
.kkp-thumbs button{flex:0 0 60px;height:60px;padding:0;border-radius:10px;overflow:hidden;border:2px solid transparent;opacity:.55;background:#120A22}
.kkp-thumbs button[aria-current="true"]{border-color:#fff;opacity:1}
.kkp-thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.kkp-qrm{max-width:420px;padding:28px;border-radius:24px;background:#160E2A;border:1px solid rgba(201,180,255,.5);text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;position:relative}
.kkp-qrm h2{font-size:22px;font-weight:900;text-transform:uppercase}
.kkp-qrm p{color:#E4DDF3;margin:0}
.kkp-qrm .kkp-qr{width:220px;height:220px}
@media (max-width:700px){.kkp-lb{flex-direction:column}.kkp-lb figure img{max-width:calc(100vw - 32px);max-height:60vh}.kkp-lb-nav{display:none}}
`;
let cssDone = false;
function injectCSS() {
  if (cssDone) return; cssDone = true;
  const st = document.createElement('style'); st.id = 'kk-product-css'; st.textContent = CSS; document.head.appendChild(st);
  if (!document.querySelector('link[data-kkp-fonts]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.kkpFonts = '1';
    l.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&family=Assistant:wght@400;600;700&display=swap';
    document.head.appendChild(l);
  }
}
let viewerLoading;
function loadViewer() {
  if (customElements.get('kk-toy-viewer')) return Promise.resolve();
  if (!viewerLoading) viewerLoading = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = VIEWER_SRC; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  return viewerLoading;
}
const extrasCache = {};
function loadExtras(slug) {
  if (!extrasCache[slug]) extrasCache[slug] = fetch(BASE + 'pages/' + slug + '.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return extrasCache[slug];
}
function qrSVG(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="QR code to open this page on your phone" shape-rendering="crispEdges"><path d="${d}" fill="#0B0614"/></svg>`;
}

// =====================================================================================
class KKProductPage extends HTMLElement {
  static get observedAttributes() { return ['product', 'cart-status']; }

  connectedCallback() {
    injectCSS();
    this.style.display = 'block';
    if (!this._ro) {
      this._ro = new ResizeObserver(() => this._fitWidth());
      this._ro.observe(document.documentElement);
      window.addEventListener('resize', () => this._fitWidth());
    }
    if (this.getAttribute('product')) this._load();
  }

  disconnectedCallback() { if (this._ro) this._ro.disconnect(); this._ro = null; }

  attributeChangedCallback(name, oldV, newV) {
    if (oldV === newV || !newV) return;
    if (name === 'product' && this.isConnected) this._load();
    if (name === 'cart-status') this._cartStatus(newV);
  }

  // Wix places custom elements in a fixed-width column; break out to the full window width.
  _fitWidth() {
    const root = this._rootEl; if (!root) return;
    const vw = document.documentElement.clientWidth;
    root.style.width = vw + 'px'; root.style.marginLeft = '0px';
    const left = root.getBoundingClientRect().left;
    root.style.marginLeft = (-left) + 'px';
  }

  async _load() {
    let p;
    try { p = JSON.parse(this.getAttribute('product')); } catch (e) { console.warn('[kk-product-page] bad product JSON', e); return; }
    if (!p || !p.id) return;
    const x = await loadExtras(this.getAttribute('slug') || p.slug);
    this._p = p; this._x = x || {};
    this._prepare();
    this._render();
  }

  // ---------- data ----------
  _prepare() {
    const p = this._p, x = this._x;
    this._opts = (p.options || []).map((o) => ({ ...o, choices: (o.choices || []).filter((c) => c.visible !== false) }));
    this._variants = (p.variants || []).filter((v) => v.visible !== false);
    this._sizeOpt = this._opts.find((o) => o.name === x.sizeOption) || null;
    this._baseOpt = this._opts.find((o) => o.name === x.baseOption) || null;
    // starting choice: ?ar=<size>|<base> link, else the listing's default, else the cheapest in-stock variant
    const sel = {};
    const params = new URLSearchParams(location.search);
    const ar = params.get('ar');
    const byName = (o, name) => o && o.choices.find((c) => c.name.toLowerCase() === String(name || '').toLowerCase());
    if (ar) {
      const [sz, bs] = ar.split('|');
      const cs = byName(this._sizeOpt, sz), cb = byName(this._baseOpt, bs);
      if (cs) sel[this._sizeOpt.id] = cs.id; if (cb) sel[this._baseOpt.id] = cb.id;
      this._arLanding = !!cs;
    }
    for (const o of this._opts) {
      if (sel[o.id]) continue;
      const d = byName(o, (x.default || {})[o.name]);
      if (d) sel[o.id] = d.id;
    }
    const start = this._match(sel) || this._variants.find((v) => v.inStock !== false) || this._variants[0];
    if (start) for (const o of this._opts) if (!sel[o.id] && start.choices[o.id]) sel[o.id] = start.choices[o.id];
    for (const o of this._opts) if (!sel[o.id] && o.choices[0]) sel[o.id] = o.choices[0].id;
    this._sel = sel; this._qty = 1; this._g = 0; this._colourText = '';
    this._colourMod = (p.modifiers || []).find((m) => m.type === 'FREE_TEXT' && (!x.colours || !x.colours.modifier || (m.title || m.name || '').toLowerCase().includes(x.colours.modifier.toLowerCase())));
    this._colourMax = (x.colours && x.colours.max) || 2;
    this._otherMods = (p.modifiers || []).filter((m) => m !== this._colourMod && m.type === 'FREE_TEXT');
    this._media = (p.media || []).filter((m) => m.url);
  }
  _match(sel) {
    return this._variants.find((v) => this._opts.every((o) => !sel[o.id] || v.choices[o.id] === sel[o.id]));
  }
  get _variant() {
    const v = this._match(this._sel);
    if (v && !v.formatted && isFinite(v.price)) v.formatted = '$' + Number(v.price).toFixed(2);
    return v;
  }
  _choice(o) { return o && o.choices.find((c) => c.id === this._sel[o.id]); }
  _chip(o, c) { const m = ((this._x.chips || {})[o.name] || {})[c.name] || {}; return { label: m.label || c.name, sub: m.sub || '' }; }
  _optLabel(o) { return ((this._x.optionLabels || {})[o.name]) || o.name.replace(/^(pick|choose|select)\s+/i, ''); }
  get _has3D() { return !!this._x.model; }
  get _viewerSize() { const c = this._choice(this._sizeOpt); return c && ((this._x.viewer || {}).sizes || {})[c.name]; }
  get _viewerBase() { const c = this._choice(this._baseOpt); return c && ((this._x.viewer || {}).bases || {})[c.name]; }

  // ---------- render ----------
  _render() {
    const p = this._p, x = this._x;
    const [main, ...rest] = String(p.name || '').split(/\s+[-–—]\s+/);
    const sub = rest.join(' – ');
    const crumbs = (p.breadcrumbs || []).slice(-1);
    const sections = (p.infoSections || []).filter((s) => !(x.hideSections || []).includes(s.title));
    const cardNames = x.cardSections || [];
    const cards = sections.filter((s) => cardNames.includes(s.title));
    const dets = sections.filter((s) => !cardNames.includes(s.title));
    const sizes = x.sizes || [];
    const html = `
<div class="kkp-in">
  <nav class="kkp-crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${crumbs.map((c) => ` / <a href="/category/${esc(c.slug)}">${esc(c.name)}</a>`).join('')} / <span aria-current="page">${esc(main)}</span></nav>
  <section class="kkp-hero" aria-label="Product">
    <div class="kkp-stage">
      ${this._has3D ? `<p class="kkp-pill" aria-hidden="true">INTERACTIVE 3D</p>
      <kk-toy-viewer model="${esc(x.model)}" controls="external"${this._viewerSize ? ` size="${esc(this._viewerSize)}"` : ''}${this._viewerBase ? ` base="${esc(this._viewerBase)}"` : ''}></kk-toy-viewer>
      <button class="kkp-stage-ar" data-ar>${icon('cube', 18)}<span data-arlabel></span></button>
      ${this._arLanding && isPhone() ? `<button class="kkp-arprompt" data-ar data-arprompt>${icon('cube', 18)}<span>View <span data-arsize></span> in your room</span></button>` : ''}`
      : (this._media[0] ? `<img src="${esc(wixImg(this._media[0].url, 1200, 1100))}" alt="${esc(this._media[0].alt || p.name)}">` : '')}
    </div>
    ${this._media.length ? `<div class="kkp-photos">
      <div class="kkp-rowhead"><h2>PHOTOS</h2><p data-galpos></p></div>
      <div class="kkp-car">
        <div class="kkp-car-vp"><div class="kkp-car-track">${this._media.map((m, i) => `<button class="kkp-tile" data-open="${i}" aria-label="Enlarge photo ${i + 1} of ${this._media.length}${m.alt ? ': ' + esc(m.alt) : ''}"><img src="${esc(wixImg(m.url, 420, 420))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div></div>
        <button class="kkp-arrow l" data-gal="-1" aria-label="Previous photos">${icon('left')}</button>
        <button class="kkp-arrow r" data-gal="1" aria-label="Next photos">${icon('right')}</button>
      </div>
    </div>` : ''}
    <div class="kkp-buy">
      <div class="kkp-title${x.character ? '' : ' nochar'}">
        ${x.character ? `<img class="kkp-char" src="${esc(BASE + x.character)}" alt="" aria-hidden="true">` : ''}
        ${x.eyebrow ? `<p class="kkp-eyebrow">${esc(x.eyebrow)}</p>` : ''}
        <h1>${esc(main)}${sub ? `<span class="kkp-sr"> – </span><span class="kkp-h1sub">${esc(sub)}</span>` : ''}</h1>
      </div>
      <div><p class="kkp-price" data-price></p><p class="kkp-pay" data-pay></p></div>
      ${x.hook ? `<p class="kkp-hook">${esc(x.hook)}</p>` : ''}
      ${this._opts.map((o) => this._optHTML(o)).join('')}
      ${this._colourMod ? this._colourHTML() : ''}
      ${this._otherMods.map((m, i) => `<div class="kkp-col"><div class="kkp-col-head"><label for="kkp-mod${i}">${esc(m.title || m.name)}</label></div><div class="kkp-field"><input id="kkp-mod${i}" data-mod="${esc(m.key)}" maxlength="${m.max || 500}" autocomplete="off"></div></div>`).join('')}
      <div class="kkp-cart">
        <p class="kkp-hint" data-summary></p>
        <div class="kkp-cartrow">
          <div class="kkp-qty"><button data-qty="-1" aria-label="Decrease quantity">−</button><output aria-live="polite" data-qtyv>1</output><button data-qty="1" aria-label="Increase quantity">+</button></div>
          <button class="kkp-add" data-add>ADD TO CART</button>
        </div>
        <p class="kkp-msg" role="status" data-msg></p>
      </div>
      <ul class="kkp-trust">
        <li><img src="${AU_MADE}" alt="" width="32" height="30">Australian Made Certified</li>
        <li>${icon('shield')}Skin-safe silicone</li>
        <li>${icon('truck')}Ships in 2–5 business days</li>
        <li>${icon('box')}Plain, unmarked packaging</li>
      </ul>
    </div>
  </section>

  ${(x.features || []).length ? `<section class="kkp-sec" aria-labelledby="kkp-love"><h2 id="kkp-love">Why you'll love ${esc(x.shortName || main)}</h2>
    <div class="kkp-feat">${x.features.map((f) => `<div class="kkp-card">${FEATURE_ICON[f.icon] || ''}<div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div></div>`).join('')}</div></section>` : ''}

  ${p.description ? `<section class="kkp-sec" aria-labelledby="kkp-about"><h2 id="kkp-about">About ${esc(x.shortName || main)}</h2><div class="kkp-card kkp-rich">${cleanHTML(p.description)}</div></section>` : ''}

  ${sizes.length ? `<section class="kkp-sec kkp-fit" aria-labelledby="kkp-fit">
    ${x.lineupImage ? `<div class="kkp-lineup" aria-hidden="true"><div class="kkp-lu-row">
      <div class="kkp-lu ref"><div class="can"></div><b>Can</b></div>
      ${sizes.map((s) => `<div class="kkp-lu" style="--r:${(s.lengthCm / sizes.reduce((a, b) => Math.max(a, b.lengthCm), 0)).toFixed(3)};--w:${((x.lineupAspect || 0.4) * (s.lengthCm / sizes.reduce((a, b) => Math.max(a, b.lengthCm), 0)) * ((s.widestCm / s.lengthCm) / (sizes[sizes.length - 1].widestCm / sizes[sizes.length - 1].lengthCm))).toFixed(3)}"><img src="${esc(BASE + x.lineupImage)}" alt="" loading="lazy"><b>${esc(s.label)}</b></div>`).join('')}
    </div></div>` : ''}
    <div class="kkp-fit-side">
      <h2 id="kkp-fit">Find your size</h2>
      ${x.sizeNote ? `<p style="color:var(--soft)">${esc(x.sizeNote)}</p>` : ''}
      <div class="kkp-tablebox"><table>
        <thead><tr><th scope="col">Size</th><th scope="col">Length</th><th scope="col">Widest</th>${sizes[0].upperCm ? '<th scope="col">Upper</th>' : ''}${sizes[0].tipCm ? '<th scope="col">Tip</th>' : ''}</tr></thead>
        <tbody>${sizes.map((s) => `<tr><th scope="row">${esc(s.label)}</th>${['lengthCm', 'widestCm', 'upperCm', 'tipCm'].filter((k) => sizes[0][k]).map((k) => `<td>${s[k].toFixed(1)} cm<small>${(s[k] / 2.54).toFixed(1)}″</small></td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>
  </section>` : ''}

  ${this._has3D ? `<section class="kkp-ar" aria-labelledby="kkp-ar">
    <div class="kkp-phone" aria-hidden="true">${x.lineupImage ? `<img data-arimg src="${esc(BASE + x.lineupImage)}" alt="">` : ''}<i></i><b data-arlen></b></div>
    <div class="kkp-ar-copy">
      <p class="kkp-eyebrow">AUGMENTED REALITY</p>
      <h2 id="kkp-ar">See it at real size, in your room</h2>
      <p>Numbers only tell you so much. Open this page on your phone, tap View in your room, and ${esc(x.shortName || main)} appears through your camera at its true size — on your bed, your floor or next to your hand.</p>
      <div class="kkp-ar-sel"><p>You'll see in AR: <strong data-arwhat></strong><span data-ardims></span></p>
        ${this._sizeOpt ? `<div class="kkp-ar-chips" role="group" aria-label="Size to view in AR">${this._sizeOpt.choices.map((c) => `<button data-o="${esc(this._sizeOpt.id)}" data-c="${esc(c.id)}">${esc(this._chip(this._sizeOpt, c).label)}</button>`).join('')}</div>` : ''}
      </div>
      <button class="kkp-ar-go" data-ar>${icon('cube')}<span data-arlabel></span></button>
    </div>
    <div class="kkp-qrbox"><div class="kkp-qr" data-qr></div><p>On a computer? Scan to open it on your phone.</p></div>
  </section>` : ''}

  ${cards.length ? `<section class="kkp-sec kkp-cards" style="--n:${Math.min(cards.length, 3)}">${cards.map((s) => `<div class="kkp-card"><h2>${esc(s.title)}</h2><div class="kkp-rich">${cleanHTML(s.html)}</div></div>`).join('')}</section>` : ''}
  ${dets.length ? `<section class="kkp-dets" aria-label="More information">${dets.map((s) => `<details><summary>${esc(s.title)}</summary><div class="kkp-rich">${cleanHTML(s.html)}</div></details>`).join('')}</section>` : ''}
</div>`;
    let root = this._rootEl;
    if (!root) { root = document.createElement('div'); root.className = 'kkp'; this.appendChild(root); this._rootEl = root; }
    root.innerHTML = html;
    this._fitWidth();
    this._bind();
    this._update();
    if (this._has3D) loadViewer().catch((e) => console.warn('[kk-product-page] viewer failed', e));
  }

  _optHTML(o) {
    if (o.choices.length < 2) return o.choices[0] ? `<p class="kkp-fixed">${esc(this._optLabel(o))}: ${esc(o.choices[0].name)}</p>` : '';
    const wide = o.choices.some((c) => (this._chip(o, c).label || '').length > 9) || o.choices.length > 4;
    const cols = wide ? 2 : Math.min(o.choices.length, 4);
    return `<fieldset class="kkp-opt"><legend><span>${esc(this._optLabel(o))}</span>${o === this._sizeOpt ? '<span data-dims></span>' : ''}</legend>
      <div class="kkp-chips" style="--cols:${cols}">${o.choices.map((c) => { const ch = this._chip(o, c); return `<button class="kkp-chip${wide ? ' wide' : ''}" data-o="${esc(o.id)}" data-c="${esc(c.id)}" aria-pressed="false"><b>${esc(ch.label)}</b>${ch.sub ? `<span>${esc(ch.sub)}</span>` : ''}</button>`; }).join('')}</div></fieldset>`;
  }

  _colourHTML() {
    const groups = Object.entries(COLOURS);
    const sw = (list, glit) => list.map(([name, label, hex, cls]) => `<button type="button" data-col="${esc(name)}" aria-pressed="false" title="${esc(name)}" aria-label="${esc(name)}"><i class="${cls || (glit ? 'glitter' : '')}" style="background-color:${hex}" data-tick="${lum(hex) > 0.6 ? '#0B0614' : '#FFFFFF'}"></i>${esc(label)}</button>`).join('');
    const grp = (name, list) => `<p class="kkp-grp">${esc(name)}</p><div class="kkp-sw">${sw(list, name === 'Glitter')}</div>`;
    const [solid, glitter, fluo, uv] = groups;
    return `<div class="kkp-col" data-colours>
      <div class="kkp-col-head"><label for="kkp-colours">Colours</label><span data-colcount></span></div>
      <div class="kkp-field"><input id="kkp-colours" data-coltext autocomplete="off" maxlength="${(this._colourMod && this._colourMod.max) || 500}" placeholder="Pick from the chart or type, e.g. Purple + Glitter Gold" aria-describedby="kkp-colhint" aria-haspopup="dialog">${icon('palette')}</div>
      <p class="kkp-hint" id="kkp-colhint">Pick up to ${this._colourMax} colours or glitters from our chart, or type your own. Leave it blank and we'll choose a stunning combo for you.</p>
      <div class="kkp-picker" role="dialog" aria-label="Colour picker" hidden>
        <div class="kkp-pk-head"><p>PICK UP TO ${this._colourMax} COLOURS</p><div style="display:flex;gap:8px;align-items:center"><span class="kkp-count" data-colpill></span><button type="button" class="kkp-ghost" data-colclear>Clear</button></div></div>
        ${grp(solid[0], solid[1])}${grp(glitter[0], glitter[1])}
        <div class="kkp-pk-two"><div style="display:flex;flex-direction:column;gap:8px">${grp(fluo[0], fluo[1])}</div><div style="display:flex;flex-direction:column;gap:8px">${grp(uv[0], uv[1])}</div></div>
        <div class="kkp-pk-foot"><p>Colours shift once mixed into silicone, so the chart is a guide only.</p><button type="button" class="kkp-primary" data-coldone>DONE</button></div>
      </div>
    </div>`;
  }

  // ---------- behaviour ----------
  _bind() {
    const r = this._rootEl;
    r.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || !r.contains(t)) return;
      if (t.dataset.o && t.dataset.c) return this._pick(t.dataset.o, t.dataset.c);
      if (t.dataset.qty) { this._qty = Math.max(1, Math.min(20, this._qty + Number(t.dataset.qty))); $(r, '[data-qtyv]').textContent = this._qty; return; }
      if (t.hasAttribute('data-add')) return this._add();
      if (t.dataset.open) return this._lightbox(Number(t.dataset.open));
      if (t.dataset.gal) { this._g += Number(t.dataset.gal); return this._galUpdate(); }
      if (t.hasAttribute('data-ar')) return this._ar();
      if (t.dataset.col) return this._toggleColour(t.dataset.col);
      if (t.hasAttribute('data-colclear')) { this._setColourText(''); return; }
      if (t.hasAttribute('data-coldone')) { this._picker(false); return; }
    });
    const colBox = $(r, '[data-colours]');
    if (colBox) {
      const input = $(colBox, '[data-coltext]');
      input.addEventListener('input', () => { this._colourText = input.value; this._colUpdate(); });
      input.addEventListener('focus', () => this._picker(true));
      input.addEventListener('click', () => this._picker(true));
      if (!isPhone()) {
        colBox.addEventListener('mouseenter', () => this._picker(true));
        colBox.addEventListener('mouseleave', () => { if (document.activeElement !== input) this._picker(false); });
      }
      document.addEventListener('pointerdown', (e) => { if (this._pickerOpen && !colBox.contains(e.target)) this._picker(false); });
      colBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this._picker(false); input.focus(); } });
    }
    const viewer = $(r, 'kk-toy-viewer'); this._viewer = viewer;
    this._galUpdate();
    window.addEventListener('resize', () => this._galUpdate());
  }

  _pick(optId, choiceId) {
    const sel = { ...this._sel, [optId]: choiceId };
    if (!this._match(sel)) {
      // that combination doesn't exist: keep the new choice and move the other options to the closest one that does
      const v = this._variants.find((x) => x.choices[optId] === choiceId);
      if (v) for (const o of this._opts) sel[o.id] = v.choices[o.id] || sel[o.id];
    }
    this._sel = sel;
    this._update();
  }

  _update() {
    const r = this._rootEl, v = this._variant;
    // chips
    $$(r, '[data-o][data-c]').forEach((b) => {
      b.setAttribute('aria-pressed', String(this._sel[b.dataset.o] === b.dataset.c));
      const test = { ...this._sel, [b.dataset.o]: b.dataset.c };
      const mv = this._match(test);
      b.classList.toggle('na', !mv || mv.inStock === false);
    });
    // price
    const price = $(r, '[data-price]'), pay = $(r, '[data-pay]');
    if (v) {
      const cmp = v.compareAt && v.compareAt > v.price ? `<s>${esc(money(v.compareAtFormatted))}</s>` : '';
      price.innerHTML = `${esc(money(v.formatted))}${cmp} <small>${esc(this._p.currency || '')}</small>`;
      pay.textContent = `or 4 interest-free payments of ${money(v.formatted).replace(/[\d.,]+/, (n) => (Number(n.replace(/,/g, '')) / 4).toFixed(2))} with Afterpay or PayPal`;
    } else { price.textContent = 'Unavailable'; pay.textContent = ''; }
    // size details + summary + add button
    const sc = this._choice(this._sizeOpt), bc = this._choice(this._baseOpt);
    const sz = sc && (this._x.sizes || []).find((s) => s.choice === sc.name);
    const dimsTxt = sz ? `${sz.lengthCm.toFixed(1)} cm long · ${sz.widestCm.toFixed(1)} cm widest` : '';
    $$(r, '[data-dims],[data-ardims]').forEach((el) => { el.textContent = dimsTxt; });
    const parts = this._opts.filter((o) => o.choices.length > 1).map((o) => this._chip(o, this._choice(o) || {}).label).filter(Boolean);
    const sum = $(r, '[data-summary]'); if (sum) sum.textContent = [this._x.shortName || '', ...parts].filter(Boolean).join(' · ');
    const add = $(r, '[data-add]');
    if (add && !this._adding) { add.textContent = v ? `ADD TO CART · ${money(v.formatted)}` : 'UNAVAILABLE'; add.disabled = !v || v.inStock === false; if (v && v.inStock === false) add.textContent = 'OUT OF STOCK'; }
    // AR labels + viewer
    if (this._has3D) {
      const sl = sc ? this._chip(this._sizeOpt, sc).label : '', bl = bc ? this._chip(this._baseOpt, bc).label : '';
      $$(r, '[data-arlabel]').forEach((el) => { el.textContent = `VIEW ${sl ? sl + ' ' : ''}IN YOUR ROOM`; });
      $$(r, '[data-arsize]').forEach((el) => { el.textContent = [sl, bl].filter(Boolean).join(' · '); });
      $$(r, '[data-arwhat]').forEach((el) => { el.textContent = [sl, bl].filter(Boolean).join(' · '); });
      const len = $(r, '[data-arlen]'); if (len) len.textContent = sz ? `${Math.round(sz.lengthCm)} cm · TRUE SIZE` : 'TRUE SIZE';
      const img = $(r, '[data-arimg]');
      if (img && sz) { const max = (this._x.sizes || []).reduce((a, b) => Math.max(a, b.lengthCm), 0); img.style.height = Math.round(130 * sz.lengthCm / max) + 'px'; }
      const qr = $(r, '[data-qr]'); if (qr) qr.innerHTML = qrSVG(this._arURL());
      if (this._viewer && this._viewerSize) {
        const vs = this._viewerSize, vb = this._viewerBase;
        if (this._viewer.select) this._viewer.select(vs, vb); else { this._viewer.setAttribute('size', vs); if (vb) this._viewer.setAttribute('base', vb); }
      }
    }
    this._colUpdate();
  }

  _arURL() {
    const u = new URL(location.href);
    const sc = this._choice(this._sizeOpt), bc = this._choice(this._baseOpt);
    u.searchParams.set('ar', [sc && sc.name, bc && bc.name].filter(Boolean).join('|'));
    u.hash = '';
    return u.toString();
  }

  _ar() {
    const v = this._viewer;
    if (isPhone() && v) {
      const pr = $(this._rootEl, '[data-arprompt]'); if (pr) pr.remove();
      if (v.openAR) { v.scrollIntoView({ block: 'center', behavior: 'smooth' }); v.openAR(); }
      return;
    }
    // computer: show a QR code that opens this exact size and base on a phone
    const sc = this._choice(this._sizeOpt), bc = this._choice(this._baseOpt);
    const what = [sc && this._chip(this._sizeOpt, sc).label, bc && this._chip(this._baseOpt, bc).label].filter(Boolean).join(' · ');
    this._overlay(`<div class="kkp-qrm"><h2 id="kkp-qrt">View it in your room</h2><div class="kkp-qr">${qrSVG(this._arURL())}</div>
      <p>Scan this with your phone's camera to see <strong>${esc(what || this._p.name)}</strong> at real size through your camera.</p></div>`, 'kkp-qrt');
  }

  // photos
  _galUpdate() {
    const r = this._rootEl, track = $(r, '.kkp-car-track'); if (!track) return;
    const n = this._media.length, vis = r.getBoundingClientRect().width <= 960 ? 2 : 4, max = Math.max(0, n - vis);
    this._g = Math.max(0, Math.min(max, this._g));
    const gap = vis === 2 ? 8 : 12;
    track.style.transform = `translateX(calc(${-this._g} * ((100% - ${gap * (vis - 1)}px) / ${vis} + ${gap}px)))`;
    $(r, '[data-gal="-1"]').disabled = this._g === 0; $(r, '[data-gal="1"]').disabled = this._g >= max;
    $$(r, '[data-gal]').forEach((b) => { b.hidden = n <= vis; });
    const pos = $(r, '[data-galpos]'); if (pos) pos.textContent = `${n} photos · click any photo to enlarge`;
    $$(r, '.kkp-tile').forEach((t, i) => { t.tabIndex = i >= this._g && i < this._g + vis ? 0 : -1; });
  }

  _lightbox(i) {
    const m = this._media, n = m.length;
    const show = (k) => {
      i = (k + n) % n;
      const ov = this._ov; if (!ov) return;
      $(ov, 'figure img').src = wixImg(m[i].url, 1600, 1600, 'fit');
      $(ov, 'figure img').alt = m[i].alt || this._p.name;
      $(ov, 'figcaption').textContent = `${i + 1} of ${n}`;
      $$(ov, '[data-th]').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.th) === i)));
    };
    this._overlay(`<div class="kkp-lb"><button class="kkp-lb-nav" data-lb="-1" aria-label="Previous photo">${icon('left', 26)}</button>
      <figure><img alt=""><figcaption></figcaption>
      <div class="kkp-thumbs">${m.map((x, k) => `<button data-th="${k}" aria-label="Photo ${k + 1}"><img src="${esc(wixImg(x.url, 120, 120))}" alt="" loading="lazy"></button>`).join('')}</div></figure>
      <button class="kkp-lb-nav" data-lb="1" aria-label="Next photo">${icon('right', 26)}</button></div>`, null, (ov) => {
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.lb) show(i + Number(b.dataset.lb));
        if (b.dataset.th) show(Number(b.dataset.th));
      });
      ov.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
      let sx = null;
      ov.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
      ov.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); sx = null; });
      show(i);
    });
  }

  _overlay(inner, labelId, setup) {
    this._closeOverlay();
    const back = document.activeElement;
    const ov = document.createElement('div'); ov.className = 'kkp-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    if (labelId) ov.setAttribute('aria-labelledby', labelId); else ov.setAttribute('aria-label', 'Photo viewer');
    ov.innerHTML = `<button class="kkp-ov-x" data-x aria-label="Close">${icon('close', 24)}</button>${inner}`;
    document.body.appendChild(ov); this._ov = ov; this._ovBack = back;
    const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; this._ovOverflow = prevOverflow;
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) this._closeOverlay(); });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeOverlay();
      if (e.key === 'Tab') { const f = $$(ov, 'button'); const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
    if (setup) setup(ov);
    $(ov, '[data-x]').focus();
  }
  _closeOverlay() {
    if (!this._ov) return;
    this._ov.remove(); this._ov = null; document.documentElement.style.overflow = this._ovOverflow || '';
    if (this._ovBack && this._ovBack.focus) this._ovBack.focus();
  }

  // colours
  _parts() { return (this._colourText || '').split('+').map((s) => s.trim()).filter(Boolean); }
  _setColourText(t) { this._colourText = t; const i = $(this._rootEl, '[data-coltext]'); if (i) i.value = t; this._colUpdate(); }
  _toggleColour(name) {
    const parts = this._parts(); const k = parts.findIndex((p) => p.toLowerCase() === name.toLowerCase());
    if (k >= 0) parts.splice(k, 1); else if (parts.length < this._colourMax) parts.push(name); else return;
    this._setColourText(parts.join(' + '));
  }
  _colUpdate() {
    const box = $(this._rootEl, '[data-colours]'); if (!box) return;
    const parts = this._parts().map((p) => p.toLowerCase()); const full = parts.length >= this._colourMax;
    $$(box, '[data-col]').forEach((b) => {
      const on = parts.includes(b.dataset.col.toLowerCase());
      b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-disabled', String(full && !on));
      const i = $(b, 'i'); i.innerHTML = on ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${i.dataset.tick}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON.check}</svg>` : '';
    });
    const n = Math.min(parts.length, this._colourMax);
    const pill = $(box, '[data-colpill]'); pill.textContent = `${n} / ${this._colourMax}`; pill.classList.toggle('full', full);
    $(box, '[data-colcount]').textContent = `${n} of ${this._colourMax} chosen`;
  }
  _picker(open) {
    const pk = $(this._rootEl, '.kkp-picker'); if (!pk) return;
    this._pickerOpen = open; pk.hidden = !open;
    $(this._rootEl, '[data-coltext]').setAttribute('aria-expanded', String(open));
  }

  // cart
  _add() {
    const v = this._variant; if (!v || this._adding) return;
    const custom = {};
    if (this._colourMod) {
      const t = (this._colourText || '').trim();
      custom[this._colourMod.key] = t || (this._colourMod.mandatory ? 'No preference – Kinky Kreatures to choose' : '');
      if (!custom[this._colourMod.key]) delete custom[this._colourMod.key];
    }
    $$(this._rootEl, '[data-mod]').forEach((i) => { if (i.value.trim()) custom[i.dataset.mod] = i.value.trim(); });
    const missing = this._otherMods.find((m) => m.mandatory && !custom[m.key]);
    const msg = $(this._rootEl, '[data-msg]');
    if (missing) { msg.className = 'kkp-msg'; msg.textContent = `Please fill in “${missing.title || missing.name}”.`; return; }
    this._adding = true; this._reqId = String(Date.now());
    const add = $(this._rootEl, '[data-add]'); add.disabled = true; add.textContent = 'ADDING…'; msg.textContent = '';
    this._addTimer = setTimeout(() => this._cartStatus(JSON.stringify({ id: this._reqId, ok: false, message: 'That took too long. Please try again.' })), 20000);
    this.dispatchEvent(new CustomEvent('kk-add-to-cart', { bubbles: true, detail: { id: this._reqId, productId: this._p.id, variantId: v.id, quantity: this._qty, customTextFields: custom } }));
  }
  _cartStatus(json) {
    let s; try { s = JSON.parse(json); } catch (e) { return; }
    if (!this._adding || (s.id && s.id !== this._reqId)) return;
    clearTimeout(this._addTimer); this._adding = false;
    const msg = $(this._rootEl, '[data-msg]');
    msg.className = 'kkp-msg' + (s.ok ? ' ok' : '');
    msg.textContent = s.ok ? 'Added to your cart.' : (s.message || 'Sorry, that didn’t work. Please try again.');
    this._update();
  }
}

if (!customElements.get('kk-product-page')) customElements.define('kk-product-page', KKProductPage);
