# kinky-kreatures-3d

3D toy viewer for [kinkykreatures.au](https://www.kinkykreatures.au), built as a Wix custom element, plus the web versions of each toy model.

## On a Wix page

Add a **Custom Element** in the Wix editor:

- **Source:** Server URL `https://cdn.jsdelivr.net/gh/AusFlexDesigns/kinky-kreatures-3d@v6/dist/kk-viewer.js`
- **Tag name:** `kk-toy-viewer`
- **Attribute:** `model` = the toy's folder name, e.g. `kraken`

## What's in here

- `src/kk-viewer.js` – the viewer (three.js): rotate and zoom, ruler (cm and inches), a diameter ring you slide up the toy (diameter and girth), soda and Monster cans for scale, cutaway, base view, size and base switching, and AR on phones.
- `models/<toy>/manifest.json` – sizes, bases and chart measurements for one toy.
- `models/<toy>/*.kkm` – scrambled, low-detail display models. They only decode inside the viewer.
- `models/<toy>/*-ar.glb` – AR models for phones: about 12,000 triangles plus a normal map baked from the full model, Draco-compressed (phones need a standard file).
- `models/_refs/` – the soda and Monster cans used for scale.
- `tools/solidify.py` – merges a working sculpt (separate body, suckers, base pieces) into one solid first: `python tools/solidify.py "Kraken - Small.obj" small_solid.ply`
- `tools/kkbuild.py` – turns one mould model (OBJ/STL) into its `.kkm` and `-ar.glb`: `python tools/kkbuild.py "Kraken - Large - Butt Base.obj" models/kraken large-butt`

Mould-quality models never go in this repo.

## Building

```
npm install
npx esbuild src/kk-viewer.js --bundle --minify --format=iife --target=es2020 --define:__VERSION__='"v6"' --outfile=dist/kk-viewer.js
```

Each release gets a new tag (`v1`, `v2`, …) and the Wix element's URL is moved to it.
