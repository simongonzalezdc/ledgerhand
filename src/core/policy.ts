/** Canonical fact/policy hashing — the core's binding primitives.
 *
 * Moved from QuorumProof's src/attest/gateway.ts (buidl-ctc @ 8ba592e) into
 * the chain-agnostic core: these encodings define what a factHash and policyId
 * ARE, independent of which chain verified the fact. Byte layouts unchanged.
 */
import { AbiCoder, keccak256 } from 'ethers';
import type { Policy } from './types.js';

const abiCoder = AbiCoder.defaultAbiCoder();

/** keccak256(uint256 chainKey, uint256 headerNumber, bytes32 txHash, bool verified) */
export function computeFactHash(f: {
  chainKey: number;
  headerNumber: number;
  txHash: string;
  verified: boolean;
}): string {
  return keccak256(
    abiCoder.encode(
      ['uint256', 'uint256', 'bytes32', 'bool'],
      [f.chainKey, f.headerNumber, f.txHash, f.verified],
    ),
  );
}

/** keccak256(address payee, uint256 expectedAmountWei, uint32 shortfallBps, uint32 overpayBps, uint256 minAmountWei)
 *  Byte-compatible with QuorumProof's CreditPolicy policyId. */
export function computePolicyId(p: Policy): string {
  return keccak256(
    abiCoder.encode(
      ['address', 'uint256', 'uint32', 'uint32', 'uint256'],
      [p.payee, p.expectedAmountWei, p.shortfallToleranceBps, p.overpayToleranceBps, p.minAmountWei],
    ),
  );
}
