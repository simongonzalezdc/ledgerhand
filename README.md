# Ledgerhand

**A ledger you can hand things to.**

Hand Ledgerhand a claim — "this payment happened on chain X" — and an agent
fleet deliberates over the *verified* fact and hands you back a **signed,
quorum-gated receipt**: every ballot, every reason, every signature, bound by
hash to the fact and the policy, auditable by anyone, anchorable on-chain.

Three heterogeneous AI agents independently evaluate the fact (round-1 secret
ballot), see the published tally, and may revise once under documented rules
(round-2 debate). Only when quorum is met does the fleet issue an EXECUTE
certificate; otherwise the rejection itself is receipted. No single agent, no
single model, no centralized oracle operator can move the decision alone.

```
claim ("tx 0x… paid 3.6 ETH to the treasury")
   │  1. FactAttestor — verify inside a chain's trust domain (binding seam)
   ▼
VerifiedFact + factHash (keccak: chainKey ++ block ++ txHash ++ verified)
   │  2. Fleet deliberation: round-1 secret ballot → debate → round-2 revise
   ▼
signed QuorumCertificate (secp256k1 ballots bound to factHash + policyId)
   │  3. ReceiptAnchor — local signature audit, or QuorumRegistry on-chain
   ▼
RECEIPT — recorded, auditable, replayable, composable
```

## Status

Core extracted and generalized from **QuorumProof** (SHIP 14/14 gate, buidl-ctc
@ `8ba592e`) — lineage and delta in `docs/LINEAGE.md`. The deterministic core
runs offline, zero keys, zero cost. The HyperEVM binding (track integration)
is Phase 1.

Colosseum Crypto World's Fair 2026 entry (deadline 11:59pm PT Oct 12, 2026).

## Run it

```bash
npm install
npm run demo    # EXECUTE path + REJECT path + signature audit, deterministic
npm run demo:llm # same demo + the real LLM analyst (local inference lane)
npm test        # offline quorum/certificate + binding + LLM + UI-server suites
npm run build   # tsc strict, green
npm run ui      # the Chamber in a browser — http://127.0.0.1:8791 (local-only)
npm run eval    # ground-truth scenario gate (12/12 required; see evals/REPORT.md)
```

## The LLM analyst (real model calls, zero spend)

`--llm` on the operator path (or the checkbox in the Chamber) adds a fourth
brain — a real LLM round-trip over the SAME verified fact, seeing the round-2
debate like every other brain. Any OpenAI-compatible endpoint works
(`LEDGERHAND_LLM_URL` / `_MODEL` / `_API_KEY`); with none configured it
defaults to the zero-cost local inference lane on `127.0.0.1:11434` (model
auto-discovered). The analyst ADDS a vote; quorum discipline is unchanged.
If the endpoint is down the operator path fails honestly; the demo falls
back deterministically and says so.

## The Chamber (UI)

`npm run ui` serves the operator slice in a browser: convene a proceeding
over a real chain fact, watch round-1 secret ballots and the round-2 debate
with every reason on record, read the sealed verdict + brass-stamped
certificate, and browse the docket of recorded receipts. Design system
inherited as-found from the ratified parent (institutional ledger, light +
midnight-ledger dark, Source Serif 4 + IBM Plex Mono, matte) — gate status
per row in `docs/DESIGN-GATES-P2.md`, evidence frames in `docs/evidence/`.
node:http only, binds 127.0.0.1, zero added dependencies; the UI and the CLI
share ONE operator pipeline (`src/operator.ts`).

## Eval discipline (CS trail)

`evals/scenarios.json` fixes 12 ground-truth scenarios for the payment-window
policy; `npm run eval` runs the deterministic fleet over them and gates at
100% (any miss is a defect); every run appends full-vote evidence lines to
`evals/trail/*.jsonl`. The first P2 run caught two real fleet defects (an
overpay-ceiling blind spot and self-directed wash payments) — evidence and
fixes in `evals/REPORT.md`. `npm run eval:llm` records the LLM-augmented
fleet as heterogeneous signal (findings, never silent gate failures).

## Hand work to the ledger (operator path)

```bash
# anchor health (also the daily HyperEVM re-probe watch)
npm run ledger -- probe all

# verify a REAL chain tx, deliberate over it, get a signed quorum receipt
npm run ledger -- verify 0x<txhash> --payee 0x<payee> --expected-eth 3.6
#   → VerifiedFact (factHash bound to chain+block+tx) → two-round fleet vote
#   → every ballot signature audited (incl. the on-chain ecrecover rehearsal)
#   → receipt appended to receipts/ledger.jsonl
```

The on-chain leg (`--onchain`: deploy `QuorumRegistry` on the anchor chain,
submit the round-2 ballots, verify the recorded decision) is fully built but
**key-gated** — it refuses without `$LEDGERHAND_ANCHOR_KEY` (exit 2). Anchor
chain: Arbitrum-Sepolia (2026-09-19 ruling; `LEDGERHAND_ANCHOR` swaps it —
HyperEVM the moment its RPC recovers). Recompile the contract after edits
with `npm run compile:contract` (solc viaIR, artifact checked in).

## What the fleet is

| Agent | Mandate | Round-2 revision rule |
|---|---|---|
| `ledger-01` | Conservative underwriter — exact-policy compliance or nothing | never revises (conviction) |
| `sentinel-02` | Fraud & anomaly control — transaction integrity only, never policy fit | sole approver facing a declined fleet: keeps the dissent, discounts confidence |
| `meridian-03` | Market & timing analyst — partial payments get weighted, not zeroed | sole denier facing a unified fleet: softens DENY to ABSTAIN |

An optional fourth **LLM analyst** joins the fleet when asked (`--llm` /
 Chamber checkbox): any OpenAI-compatible endpoint via env, or the zero-cost
 local inference lane by default. The default demo and CLI stay fully
 deterministic: zero paid services, zero keys, fully reproducible.

## License

MIT. The on-chain counterpart is `contracts/QuorumRegistry.sol` — byte-level
compatible with the certificate hashing in `src/core/certificate.ts`.
