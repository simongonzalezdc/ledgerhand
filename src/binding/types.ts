/** Ledgerhand binding seam — where the chain-agnostic core meets a chain.
 *
 * This is THE generalization point extracted from QuorumProof: in the parent,
 * the trust boundary (Attestcoin precompile on Creditcoin) and the enforcement
 * rail (QuorumRegistry on CC3) were hard-wired. Ledgerhand makes them
 * interfaces so any ecosystem track can implement them:
 *
 *  - FactAttestor: how a claim becomes a VerifiedFact with a factHash.
 *    NOTHING enters the fleet's deliberation unless it passed through here.
 *  - ReceiptAnchor: how a signed QuorumCertificate becomes an on-chain fact.
 *    (Deployed QuorumRegistry satisfies this on any EVM chain.)
 */

import type { VerifiedFact } from '../core/types.js';
import type { DeliberationTrace } from '../core/types.js';

/** A claim to be verified: enough to fetch/prove the underlying on-chain fact. */
export interface FactClaim {
  /** e.g. 'hyperevm-tx' | 'ethereum-tx' — binding-specific namespace */
  claimKind: string;
  /** binding-specific locator (tx hash, txhash+logIndex, ...) */
  locator: string;
  /** free-form params the attessor may need (addresses, topics, ...) */
  params?: Record<string, string>;
}

export interface FactAttestor {
  readonly label: string;
  /** Verify a claim inside this attessor's trust domain. Throws if unverifiable;
   *  a returned fact with verified=false is a valid, deliberate outcome. */
  verify(claim: FactClaim): Promise<VerifiedFact>;
}

export interface ReceiptAnchor {
  readonly label: string;
  /** Anchor a signed certificate on-chain; returns the enforcement reference. */
  anchor(trace: DeliberationTrace): Promise<{ txHash: string; registry: string }>;
}
