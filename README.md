# kinky-kreatures-3d

3D toy viewer for [kinkykreatures.au](https://www.kinkykreatures.au), built as a Wix custom element, plus the web versions of each toy model.

## On a Wix page

Add a **Custom Element** in the Wix editor:

- **Source:** Server URL `https://cdn.jsdelivr.net/gh/AusFlexDesigns/kinky-kreatures-3d@v3/dist/kk-viewer.js`
- **Tag name:** `kk-toy-viewer`
- **Attribute:** `model` = the toy's folder name, e.g. `kraken`

## What's in here

- `src/kk-viewer.js` – the viewer (three.js): rotate and zoom, ruler (cm and inches), soda and Monster cans for scale, cutaway, base view, size and base switching, and AR on phones.
- `models/<toy>/manifest.json` – sizes, bases and chart measurements for one toy.
- `models/<toy>/*.kkm` – scrambled, low-detail display models. They only decode inside the viewer.
- `models/<toy>/*-ar.glb` – AR models for phones: about 12,000 triangles plus a normal map baked from the full model, Draco-compressed (phones need a standard file).
- `tools/` – the scripts that turn a mould model (OBJ/STL) into the files above (`ar_bake.py` makes the AR file).

Mould-quality models never go in this repo.

## Building

```
npm install
npx esbuild src/kk-viewer.js --bundle --minify --format=iife --target=es2020 --define:__VERSION__='"v3"' --outfile=dist/kk-viewer.js
```

Each release gets a new tag (`v1`, `v2`, …) and the Wix element's URL is moved to it.
