# Ledgerhand eval trail — report of record (P2, 2026-09-25)

Interface IF-59 (PM ↔ CS evals): the PM lane ships the model-bearing product
through a CS-verifiable eval trail. This file plus `evals/trail/*.jsonl` IS
that trail — evidence, not self-certification. CS owns eval truth; approval
is theirs to give from these artifacts.

## What the trail contains

- `evals/scenarios.json` — the ground-truth suite (`ledgerhand-payment-window-v1`,
  12 scenarios): every scenario fixes a fact + policy and states the correct
  DECISION, derived from the policy's plain-language contract (payee match,
  amount inside `[expected·(1−shortBps), expected·(1+overBps)]`, not reverted,
  economically substantive, externally funded).
- `evals/trail/run-*.jsonl` — append-only run records: one JSON line per
  scenario with every vote, reason, confidence, quorum, certHash, factHash.
- `npm run eval` — the deterministic GATE (exit 1 on any miss).
  `npm run eval:llm` — the LLM-augmented record run (findings, not gate).

## Run of record — deterministic fleet (2026-09-25T17:20Z)

**12/12 PASS (100%).** Trail: `evals/trail/run-2026-09-25T17-20-08-718Z.jsonl`.
Per-agent agreement with ground truth (final votes): ledger-01 12/12,
meridian-03 10/12, sentinel-02 8/12 — sentinel's mandate is integrity-only,
so its disagreements on policy-fit scenarios (S05, S06, S10…) are by design,
not defects; the quorum, not any single agent, carries the decision.

### Findings the trail caught (and their fixes)

The suite's FIRST run (`evals/trail/run-2026-09-25T17-19-17-560Z.jsonl`, kept
as evidence) was **10/12** and exposed two real fleet defects:

1. **S05 overpay-beyond-tolerance → wrongly EXECUTED (2/3).** Meridian's
   coverage check tested only the shortfall edge (`value >= minWei`), so a
   10%-over payment (tolerance 5%) passed its market lens; sentinel's
   integrity lens saw nothing wrong; quorum fired on 2 approvals. Fix:
   meridian now checks BOTH window edges (`src/core/brains.ts`, P2 eval
   finding S05 comment). Post-fix: REJECT 1/3.
2. **S09 self-directed wash payment → wrongly EXECUTED (2/3).** A transfer
   funded by the payee itself (from == payee == to) satisfied the letter of
   the policy for ledger/meridian; only sentinel flagged it. Fix: the
   underwriter now rules a self-directed transfer is not a policy payment
   (`src/core/brains.ts`, P2 eval finding S09 comment). Post-fix: REJECT 1/3.

Both fixes left the P1 demo certificates byte-identical
(`0xbdd2a354…e0033` / `0xadac400d…1f405` — re-verified after the change) and
all 44 tests green. This loop — ground-truth suite → miss → evidence-cited
fix → green — is the discipline the trail exists to enforce.

### Honesty notes

- **CertHash repeats across REJECT scenarios in trail files are a fixture
  artifact, not a collision.** `factHash` binds `(chainKey, headerNumber,
  txHash, verified)` (the parent's byte-compatible definition), and synthetic
  scenarios mutate derived fields (value, `to`, status) while holding the tx
  slot fixed — impossible for real chain facts, where distinct facts have
  distinct tx slots. S12 (different chainKey + txHash) correctly shows a
  distinct certHash.
- **LLM-augmented run:** recorded below when complete; misses there are
  findings about the LLM lane (heterogeneous signal), never gate failures,
  and never silently dropped.

## LLM-augmented record run

(run in flight at time of writing — appended at completion)
