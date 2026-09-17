/** Deterministic offline demo fixtures — zero keys, zero cost, reproducible.
 *  Ported from QuorumProof's pipeline demoScenario (buidl-ctc @ 8ba592e),
 *  generalized to VerifiedFact/Policy. */
import { computeFactHash } from './core/policy.js';
import type { Policy, VerifiedFact } from './core/types.js';

export function demoPolicy(): Policy {
  return {
    kind: 'payment',
    payee: '0x172AC97E50915292F2B3E8B56f6b4DDf80aC0489',
    expectedAmountWei: 3_599_966_400_000_000_000n, // 3.5999664 ETH
    shortfallToleranceBps: 100, // 1%
    overpayToleranceBps: 500, // 5%
    minAmountWei: 500_000_000_000_000n, // 0.05 ETH dust floor
  };
}

export function demoFact(overrides: Partial<VerifiedFact> = {}): VerifiedFact {
  const base = {
    domain: 'payment' as const,
    chainKey: 3,
    sourceChain: 'ethereum',
    headerNumber: 25_914_979,
    txIndex: 23,
    txHash: '0x' + 'ab'.repeat(32),
    verified: true,
    verifiedVia: 'test harness (offline)',
    from: '0x9395704E478EB664D5Eb58ecfcf7031724cF367B',
    to: '0x172AC97E50915292F2B3E8B56f6b4DDf80aC0489',
    valueWei: 3_599_966_400_000_000_000n,
    calldata: '0x',
    txType: 0,
    receiptStatus: 1,
    factHash: computeFactHash({
      chainKey: 3,
      headerNumber: 25_914_979,
      txHash: '0x' + 'ab'.repeat(32),
      verified: true,
    }),
  };
  return { ...base, ...overrides };
}
