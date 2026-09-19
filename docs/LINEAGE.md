# Ledgerhand ← QuorumProof: lineage and generalization delta

Scoping deliverable (PM-ARENA, 2026-09-17). Source of record: QuorumProof at
`~/workspaces/buidl-ctc` commit `8ba592e` (final gate SHIP 14/14, receipt
`org-hq/docs/cfo-corpus/gates/final-quorumproof-0908.md`). Extraction was
read-only against the git object — the parent working tree (now the kinocut
film lane) was never touched.

## What was extracted verbatim (the asset)

| File (Ledgerhand) | From (QuorumProof @ 8ba592e) | Change |
|---|---|---|
| `src/core/certificate.ts` | `src/agents/certificate.ts` | none — canonical byte layout MUST keep matching `contracts/QuorumRegistry.sol` |
| `contracts/QuorumRegistry.sol` | `contracts/QuorumRegistry.sol` | none — generic EVM registry; comments still mention Creditcoin/Attestcoin (provenance kept deliberately; rebrand is a Phase-2 polish item, low priority) |
| `src/core/fleet.ts` | `src/agents/fleet.ts` | constructor → options bag `{brains, quorum, chainLabel}`; `chain` field now a label (was `'cc3-testnet'`); policy hashing imported from `./policy.js` (was `../attest/gateway.js`); deliberation semantics unchanged |
| `src/core/brains.ts` | `src/agents/brains.ts` | `CreditPolicy`→`Policy` (`lender`→`payee`), credit-repayment wording→payment wording, LLM prompt generalized; mandates + revision rules + confidence numbers unchanged |
| `test/fleet.test.ts` | `test/fleet.test.ts` | imports repointed; all assertions preserved |
| demo fixtures | `src/pipeline.ts` demoPolicy/demoScenario | split into `src/demo.ts` (offline, no gateway dependency) |

## What was deliberately NOT carried over (the Creditcoin coupling)

- `src/attest/gateway.ts` — Attestcoin ProofBuilder + BlockProver precompile
  (CC3). Its two pure hashing functions (`computeFactHash`, `computePolicyId`)
  moved to `src/core/policy.ts` **with identical ABI encodings** (byte
  compatibility of factHash/policyId preserved). The network attestation logic
  is replaced by the `FactAttestor` seam.
- `src/chain/registry.ts` — CC3 provider/config coupling. Replaced by the
  `ReceiptAnchor` seam (the Solidity registry itself carries over).
- `@gluwa/usc-sdk` dependency — Creditcoin-specific; dropped.
- `src/config.ts` CC3 constants — replaced by `LEDGERHAND_*` env vars
  (LLM optional; no chain config hard-wired).
- Web dashboard (`src/web/`) — Phase 2 rebuild on the new seam (design system
  assets in parent's `DESIGN-SYSTEM.md` remain the reference).

## The generalization seam (what makes it Ledgerhand)

`src/binding/types.ts` defines the two interfaces every ecosystem track
implements:

- **`FactAttestor`** — `verify(claim) → VerifiedFact{factHash}`: the trust
  boundary. Nothing enters deliberation unless it passed through one.
- **`ReceiptAnchor`** — `anchor(trace) → {txHash, registry}`: the enforcement
  rail. `QuorumRegistry` on any EVM chain satisfies it unchanged.

`src/binding/hyperliquid.ts` carries the PRIMARY track binding status
(HyperEVM mainnet read RPC verified 2026-09-17, chainId 999; official testnet
endpoint TLS-failing from this Mac — see PM-ARENA desk).

## Honesty notes

- Certificate domain separator is still the string `'QUORUMPROOF_V1'`
  (certificate.ts) — changing it would fork the hash lineage; keep until a
  Ledgerhand-specific registry deployment makes a v2 separator worthwhile.
- The reference policy is a payment-window policy (the parent's lending
  domain generalized in name only). Hyperliquid-specific policies/brains are
  Phase 1 product work, composed alongside the reference fleet.

## P1 delta (2026-09-19, PM-ARENA — anchor ruling + binding seam built)

- **Contract byte-match fixes (inherited upstream bugs).** The parent
  `QuorumRegistry.sol` computed the ballot digest with `abi.encodePacked`
  (uint8 round/vote as 1 byte) and the certHash packed WITHOUT `approvals`,
  while the TS side (`voteDigest`/`certificateHash`) used
  `defaultAbiCoder.encode` (uint8 padded to 32-byte words; approvals
  included). The two sides would never agree — `submitDecision` would revert
  `BadSigner` on every ballot and the on-chain certHash would never equal the
  off-chain certificate's. Latent upstream because QuorumProof's gates only
  recovered signatures locally (`verifyMessage`), never through the contract.
  Fixed here to `abi.encode` on both sites (contracts/QuorumRegistry.sol,
  submitDecision digest + certHash); byte-match pinned by
  test/binding.test.ts against independent word-level constructions.
- **viaIR compile.** `submitDecision`'s 10 parallel-array params exceed the
  legacy EVM pipeline's stack frame — compile with `viaIR: true`
  (scripts/compile-contract.ts, solc 0.8.28) or it fails "Stack too deep".
  Artifact checked in at artifacts/QuorumRegistry.json.
- **Anchor ruling.** P1 anchor = Arbitrum-Sepolia (Hyperliquid fallback per
  desk track-fit; both HyperEVM endpoints dead from this host at P0-close —
  probe table on the desk). Hyperliquid remains the preferred CONTEST track;
  re-anchoring is `LEDGERHAND_ANCHOR=hyperevm-testnet` away. Config:
  src/binding/anchors.ts.
- **New seam implementations:** `rpc.ts` (read-only JSON-RPC client),
  `evm.ts` (EvmFactAttestor — any EVM chain), `local.ts` (LocalReceiptAnchor
  receipt book), `registry.ts` (QuorumRegistryAnchor — deploy/submit/verify,
  key-gated behind `LEDGERHAND_ANCHOR_KEY`, CEO's hands per desk §CEO-GATED
  item LH-G1), `src/ledgerhand.ts` (operator CLI: probe + verify).
