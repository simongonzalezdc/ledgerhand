/** Shared types for verified facts, votes, deliberation, and quorum certificates.
 *
 * Chain-agnostic core of Ledgerhand. Extracted from QuorumProof
 * (buidl-ctc @ 8ba592e, src/agents/types.ts) and generalized:
 *  - AttestedFact → VerifiedFact: the fact no longer assumes Creditcoin's
 *    Attestcoin precompile; any trust domain that can bind a factHash works
 *    (see src/binding/types.ts — FactAttestor).
 *  - CreditPolicy → Policy: the payment-window reference policy, unchanged
 *    ABI encoding (see src/core/policy.ts).
 *  - QuorumCertificate.chain: free-form binding label (was 'cc3-testnet').
 */

/** The reference fact domain: an on-chain payment/transfer, verified inside
 * some chain's trust domain. Product layers may add domains; the fleet only
 * ever sees facts that already passed a FactAttestor. */
export interface VerifiedFact {
  domain: 'payment';
  /** Numeric source identifier (namespace for factHash; e.g. EVM chainId) */
  chainKey: number;
  /** Human label of the source chain (e.g. 'hyperevm', 'ethereum') */
  sourceChain: string;
  /** Source-chain block the tx is proven in */
  headerNumber: number;
  txIndex: number;
  txHash: string;
  verified: boolean;
  /** Trust domain that verified this fact (e.g. 'HyperEVM receipt read') */
  verifiedVia: string;
  from: string;
  to: string;
  valueWei: bigint;
  calldata: string;
  txType: number;
  receiptStatus: number | null;
  /** keccak256 binding: chainKey ++ headerNumber ++ txHash ++ verified */
  factHash: string;
  /** Attested height observed when the fact was verified, if applicable */
  attestedHeight?: number;
  /** Raw transaction bytes, for audit views */
  txBytes?: string;
  /** Raw proof artifacts, for audit views */
  proofArtifacts?: {
    merkleRoot: string;
    merkleSiblings: { hash: string; isLeft: boolean }[];
    continuity: { lowerEndpointDigest: string; roots: string[] };
  };
}

/** The policy the fleet deliberates against (reference: payment window).
 *  ABI encoding unchanged from QuorumProof's CreditPolicy — same five words
 *  (address, uint256, uint32, uint32, uint256) — so certificate/policy hashes
 *  and the Solidity registry remain byte-compatible. */
export interface Policy {
  kind: 'payment';
  /** Expected recipient of the payment (payee / treasury) */
  payee: string;
  /** Expected payment amount in wei */
  expectedAmountWei: bigint;
  /** Allowed shortfall, basis points of expectedAmountWei (e.g. 10 = 0.1%) */
  shortfallToleranceBps: number;
  /** Allowed overpayment, basis points (e.g. 500 = 5%) */
  overpayToleranceBps: number;
  /** Minimum plausible payment; below this the fact is dust */
  minAmountWei: bigint;
}

export type VoteKind = 'APPROVE' | 'DENY' | 'ABSTAIN';

export interface Vote {
  agentId: string;
  agentKind: 'deterministic' | 'llm';
  /** Agent control address (secp256k1 identity used to sign the vote) */
  agentAddress: string;
  vote: VoteKind;
  /** 0..1 self-reported confidence */
  confidence: number;
  reasons: string[];
  round: 1 | 2;
  /** EIP-191 personal_sign signature over voteDigest */
  signature?: string;
}

/** What each round-2 voter sees: the aggregate of round 1. */
export interface RoundSummary {
  approvals: number;
  denials: number;
  abstentions: number;
  /** keccak256 over each round-1 vote's commit — the "ballot box" hash */
  ballotBoxHash: string;
}

export type DecisionKind = 'EXECUTE' | 'REJECT';

export interface QuorumCertificate {
  factHash: string;
  policyId: string;
  txLabel: string;
  decision: DecisionKind;
  quorum: { approvals: number; denials: number; abstentions: number; fleetSize: number; required: number };
  votes: Vote[];
  certHash: string;
  createdAt: string;
  /** Binding label of the enforcement domain (e.g. 'hyperevm-testnet', 'local') */
  chain: string;
  /** Where the decision can be enforced on-chain, if configured */
  registry?: string;
}

/** Full observable trace of one fleet assessment — the audit trail. */
export interface DeliberationTrace {
  fact: VerifiedFact;
  policy: Policy;
  policyId: string;
  rounds: { round: 1 | 2; votes: Vote[] }[];
  ballotBoxHash: string;
  certificate: QuorumCertificate;
  timings: { proofMs: number; verifyMs: number; decodeMs: number; deliberateMs: number };
}
