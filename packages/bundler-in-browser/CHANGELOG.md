# bundler-in-browser

## 0.3.0

### Minor Changes

- 8b1b335: refactor with cleaner api and workflow

### Patch Changes

- 0c19f98: fix: resolve esm instead of commonjs
- d9ec9c8: new npm client impl
- d81558c: allow patch package.json before installing it
- 1739acc: make IFs type declaration more versatile
- 3f45e54: rename vendorExports to importedPaths
- 11188ec: fix incorrect guide about onLoad args.path
- 2796ef6: add collecting for each user file's dependents
- d809d43: change esbuild-wasm as peer dep

## 0.2.0

### Minor Changes

- 19b1452: refactor: compile -> build

### Patch Changes

- de50aeb: add blocklist the npm option
- 688ce60: fix npm duplicate link err
- fd6dea4: recommend @zenfs/core instead of memfs - better performance

## 0.1.7

### Patch Changes

- 1b5a45c: fix MiniNPM stuck when no dependency
- 642ea1e: correct vue error location for script SyntaxError & sass error
- 8579fa4: auto detect entry, checks js,ts and / and /src/

## 0.1.6

### Patch Changes

- add tailwindcss
