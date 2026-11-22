# Brickwright Desktop

This directory contains the Electron shell only. The editor and bundled SPIKE extension are built by the repository's existing webpack build and staged into `desktop/build`; the root package's `main` entry remains unchanged.

## Local build

From the repository root, build the editor and prepare its staged assets, then install the pinned desktop dependencies:

```sh
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npx patch-package --error-on-fail
npm run build
npm run desktop:asset-inventory
node desktop/scripts/stage-desktop.mjs --build-type development --platform local
npm ci --prefix desktop --no-audit --no-fund
npm run prepare:assets --prefix desktop
node desktop/scripts/generate-notices.mjs
npm run test --prefix desktop
npm run smoke --prefix desktop
npm start --prefix desktop
```

The standard SPIKE extension is served from the staged editor build under `app://brickwright/`. No separate development server or external SPIKE CDN is used by the packaged application.

## License and distribution status

The web application is GPL-3.0. The SPIKE extension source retains its MPL-2.0 header. Desktop build notices and media rights inventory are generated from the lockfiles and library manifests. Rights not verified in `compliance/assets-rights.json` remain explicitly `UNVERIFIED`; formal release fails closed while any such entry or unknown dependency license remains.

Development Windows/macOS builds are unsigned CI artifacts. Formal releases require Windows signing credentials, Apple Developer ID signing and notarization credentials, a passing distribution compliance gate, and a same-commit source archive.
