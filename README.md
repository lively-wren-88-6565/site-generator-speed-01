# site-generator-speed-01

[![site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/lively-wren-88-6565/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/lively-wren-88-6565/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for [makefun-site 1.0.0](https://make.fun/bounty/site-generator-speed-01-run-20261122), entered in the [site-generator-speed-01-run-20261122 bounty](https://make.fun/bounty/site-generator-speed-01-run-20261122) on [make.fun](https://make.fun).

`solve.js` exports `run(input)`, returning byte-for-byte the output tree
makefun-site 1.0.0's `build` returns for the same input: every page's
`index.html`, the index and tag pages, `build-report.txt` and each static
file. `main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each alone with `run`, and writes
`/output/answers.json`.

How it is faster, without changing any answer:

- Markdown is rendered in a single fused pass (no lexer token objects, no
  per-character escaping: literal runs are escaped in one go).
- Templates are parsed once per case and compiled to JavaScript functions,
  so rendering is straight-line code instead of a node-tree walk with a
  scope chain; loop bindings are flattened into one scope object.
- Slugs are memoised per case and ASCII strings skip Unicode normalisation.
- Word counting, front-matter parsing and link resolution are hand-written
  scans instead of regular-expression matches and throwaway arrays.

Nothing is cached from one case to the next: every `run(input)` builds its
own slug cache and its own compiled templates. No WebAssembly, no native
addon, no prebuilt binary, no dependencies. Node 22.
