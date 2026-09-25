# Design gates P2 — the Chamber UI slice, judged against the ratified parent (as-found)

Parent of record: QuorumProof final gate **SHIP 14/14** (2026-09-09, `8ba592e`)
— `org-hq/docs/cfo-corpus/gates/final-quorumproof-0908.md`, spec
`DESIGN-SYSTEM.md` incl. the dark-mode amendment. The build plan's P2 line
("design gates from ratified parent as-found") means: re-apply the parent's
14 gate rows to the Ledgerhand slice and report each one honestly — verified
rows carry their evidence, unverified rows say so. This file is a self-check
by the PM seat for the Lead's Oct 3 gate review; it claims nothing that was
not run.

## Evidence basis (this session, 2026-09-25)

- Live server `http://127.0.0.1:8791` (node:http, local-only bind), anchor
  arb-sepolia live, one REAL proceeding convened through the browser (4-brain
  fleet incl. the LLM analyst) plus deterministic proceedings.
- Playwright 1.60 (WebKit) scripted pass: fresh context, console listeners
  whole session, computed-style token reads, viewport resizes 1440→390→320,
  reduced-motion emulation, `document.fonts` checks, reload-persistence probe.
- Contrast ratios computed from the exact token hex pairs (WCAG relative
  luminance math), light and dark.
- Frames: `docs/evidence/chamber-light-1440x900.png`,
  `docs/evidence/chamber-dark-1440x900.png`.

## The parent's 14 rows, re-applied

| # | skill | parent check | Ledgerhand P2 status | evidence |
|---|---|---|---|---|
| 1 | a11y-pass | console-cold-load-light | **PASS (verified)** — 0 console errors/warnings across cold load + live convene + docket render | Playwright WebKit session listeners; also verified via a second browser (CloakBrowser/Chromium) after fixing the one favicon 404 (inline SVG icon added) |
| 2 | deslop-ui | chamber-first-viewport | **PASS (verified)** — 1440×900 light first viewport: EXHIBIT A stamp + Round I/II ballots + verdict EXECUTE + brass seal all in fold; matte (zero `-gradient(` in stylesheet, pinned by test); no emoji, no icon library, no card grid | light frame; `test/ui.test.ts` matte assertion |
| 3 | web-typography | dual-type-loading | **PASS (verified)** — Source Serif 4 (500/600/700) + IBM Plex Mono (400/500) SELF-HOSTED woff2 (parent pattern), `document.fonts.check` true for both; mono data with tabular-nums | Playwright fonts probe; `src/ui/assets/fonts/` |
| 4 | color-system | contrast-light | **PASS (verified)** — ink/paper 13.84, ink-dim 5.75, execute 5.09, reject 6.76, seal 4.63, link 9.20 — the parent's exact numbers reproduced from the parent's exact hex tokens | computed from tokens; all 9 light pairs ≥4.5 |
| 5 | data-viz | hashes-links-copy | **PASS (verified)** — full 64-hex factHash/certHash/policyId/ballotBoxHash in DOM with COPY buttons (clipboard + fallback), explorer link (sepolia.arbiscan.io, verified 200), aria-live=polite on verdict + tally | DOM probes; frames |
| 6 | a11y-pass | keyboard operability | **PASS (verified)** — skip link first; docket rows tabbable (tabIndex + role=button + aria-expanded) and Enter/Space open detail; all controls labeled | markup + keyboard handlers in ui.js; row semantics visible in accessibility snapshots |
| 7 | responsive-layout | reflow-390 | **PASS (verified, after fix)** — scrollWidth 390 === innerWidth 390 (first pass failed at 628: nowrap status chips + unwrapped ballots tables; both fixed — chips wrap, tables sit in `.tablewrap`) | Playwright viewport probe |
| 8 | responsive-layout | reflow-320 | **PASS (verified)** — scrollWidth 320 === innerWidth 320 | same |
| 9 | color-system | dark-midnight-ledger | **PASS (verified)** — dark tokens computed-style EXACT: paper #16181D, raised #1E2128, rule #3A3E48, ink #EDE9DF, ink-dim #A8A498, execute #3DBE84, reject #E06A5A, seal #C9A45C, link #7FA8C9; toggle aria-pressed=true; matte; all 9 dark pairs ≥4.5 (ink 14.65 / ink-dim 7.13 / execute 7.52 / reject 5.39 / seal 7.57 / link 7.06 — parent's numbers) | computed-style token read; contrast math; dark frame |
| 10 | a11y-pass | console-cold-load-dark | **PASS (verified)** — same session through the dark toggle: cumulative console count still 0 | Playwright session |
| 11 | theming | toggle-persist-noflash | **PASS (verified)** — dark survives reload (dataset + localStorage), inline pre-paint script in `<head>`, light confirmed default on a fresh context | reload probe; fresh-context probe |
| 12 | micro-motion | reduced-motion-statics | **PASS (verified)** — under emulated prefers-reduced-motion: 0 running animations; ballots placed, seal rendered, verdict parses statically | Playwright reduced-motion probe |
| 13 | component-states | honest-offline-state | **PASS (code-verified; live-cut NOT re-enacted this session)** — anchor-down path: status banner `ANCHOR OF RECORD UNREACHABLE — CONVENE DISABLED`, submit disabled with honest label; server-unreachable path handled. The parent proved this row by aborting the health route in a live session; this session verified the code paths and the disabled-button state machine, not a live anchor cut | `ui.js` loadAnchors/catch; markup `#offlineBanner` |
| 14 | component-states | invalid-tx-error | **PASS (verified)** — `0xdeadbeef` → HTTP 422 `PROCEEDING REFUSED — enter a 32-byte transaction hash…` (role=alert client-side, error contract server-side, pinned by test) | `test/ui.test.ts` refusal test |

**Self-check tally: 14/14 — 13 fully verified this session, 1 (row 13)
code-verified with the live-cut enactment deferred to the Lead's gate
review.** Deliberate deltas from the parent, declared: (a) the proceeding is
convened from a form at the top (operator entry) rather than pre-seeded —
the chamber below it carries the ceremony; (b) fonts are the same two
typefaces at the same weights, fetched once and self-hosted in-repo; (c) the
seal is an inline SVG typographic stamp (the parent's "ONE seal glyph" rule
kept — no icon set introduced).
