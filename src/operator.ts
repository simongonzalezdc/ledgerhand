/** Shared operator pipeline — ONE code path for the CLI and the UI.
 *
 *   verify a claim → deliberate → audit → receipt
 *
 * Extracted from the P1 CLI (src/ledgerhand.ts) in P2 so the Chamber UI and
 * the terminal operator run byte-identical logic; the CLI keeps only arg
 * parsing and printing, the UI keeps only rendering.
 */
import { parseEther } from 'ethers';
import { Fleet, auditCertificateSignatures } from './core/fleet.js';
import { resolveLlmBrain } from './core/llmlane.js';
import { resolveAnchor } from './binding/anchors.js';
import { EVM_TX_CLAIM, EvmFactAttestor } from './binding/evm.js';
import { JsonRpcClient } from './binding/rpc.js';
import { LocalReceiptAnchor } from './binding/local.js';
import { rehearsalRecovery } from './binding/registry.js';
import type { DeliberationTrace, Policy, VerifiedFact } from './core/types.js';

export interface VerifyRequest {
  txHash: string;
  payee: string;
  expectedEth: string;
  shortfallToleranceBps?: number;
  overpayToleranceBps?: number;
  minEth?: string;
  anchor?: string;
  /** include the LLM analyst as a 4th brain (env lane, else local inference) */
  llm?: boolean;
  ledgerPath?: string;
}

export interface VerifyResult {
  fact: VerifiedFact;
  policy: Policy;
  policyId: string;
  trace: DeliberationTrace;
  audit: { ok: boolean; failures: string[] };
  rehearsal: { ok: boolean; failures: string[] };
  receipt: { txHash: string; registry: string };
  llmVia?: string;
  anchorLabel: string;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateVerifyRequest(req: VerifyRequest): void {
  if (!TX_HASH_RE.test(req.txHash)) {
    throw new Error(`PROCEEDING REFUSED — enter a 32-byte transaction hash (0x + 64 hex), got '${req.txHash.slice(0, 20)}…'`);
  }
  if (!ADDR_RE.test(req.payee)) {
    throw new Error(`PROCEEDING REFUSED — payee must be a 20-byte address (0x + 40 hex)`);
  }
  const n = Number(req.expectedEth);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) {
    throw new Error(`PROCEEDING REFUSED — expected amount must be a positive ETH amount`);
  }
}

export function policyFromRequest(req: VerifyRequest): Policy {
  return {
    kind: 'payment',
    payee: req.payee,
    expectedAmountWei: parseEther(req.expectedEth),
    shortfallToleranceBps: req.shortfallToleranceBps ?? 100,
    overpayToleranceBps: req.overpayToleranceBps ?? 500,
    minAmountWei: parseEther(req.minEth ?? '0.05'),
  };
}

/** The full operator path: verify → deliberate → audit → local receipt.
 *  (The on-chain QuorumRegistry leg stays CLI-gated behind the CEO key, LH-G1.) */
export async function runVerification(req: VerifyRequest): Promise<VerifyResult> {
  validateVerifyRequest(req);
  const anchor = resolveAnchor(req.anchor);
  const policy = policyFromRequest(req);

  // 1. VERIFY — read-only chain fact
  const attestor = new EvmFactAttestor(new JsonRpcClient(anchor.rpcUrl), anchor);
  const fact = await attestor.verify({ claimKind: EVM_TX_CLAIM, locator: req.txHash });

  // 2. DELIBERATE — two-round quorum over the verified fact
  let fleet: Fleet;
  let llmVia: string | undefined;
  if (req.llm) {
    const lane = await resolveLlmBrain();
    llmVia = lane.via;
    fleet = new Fleet({ chainLabel: anchor.label, extraBrains: [lane.brain] });
  } else {
    fleet = new Fleet({ chainLabel: anchor.label });
  }
  const trace = await fleet.deliberate(fact, policy);

  // 3. AUDIT — every ballot signature + the on-chain ecrecover rehearsal
  const audit = auditCertificateSignatures(trace);
  const rehearsal = rehearsalRecovery(trace);
  if (!audit.ok || !rehearsal.ok) {
    throw new Error(`audit FAILED: ${[...audit.failures, ...rehearsal.failures].join('; ')}`);
  }

  // 4. RECEIPT — local receipt book (on-chain leg = CLI --onchain, key-gated)
  const local = new LocalReceiptAnchor(req.ledgerPath ?? 'receipts/ledger.jsonl');
  const receipt = await local.anchor(trace);

  return { fact, policy, policyId: trace.policyId, trace, audit, rehearsal, receipt, llmVia, anchorLabel: anchor.label };
}
