/** EVM FactAttestor — turns "tx 0x… happened on chain X" into a VerifiedFact
 * by READING the chain (read-only, no keys, free).
 *
 * The trust domain is the anchor's JSON-RPC endpoint: if the node says the
 * transaction exists, is mined, and has a receipt, the fact is verified with
 * `verified: true` and the receipt status carried separately for the brains
 * to rule on (a reverted tx is a VERIFIED fact about a FAILED payment — the
 * fleet must see it and deny it, not have it silently dropped).
 *
 * Works against any EVM RPC (Arbitrum-Sepolia now; HyperEVM the moment its
 * endpoint recovers — see anchors.ts ruling), which is the entire point of
 * the chain-agnostic seam.
 */
import { computeFactHash } from '../core/policy.js';
import type { VerifiedFact } from '../core/types.js';
import type { AnchorConfig } from './anchors.js';
import { hexToNum, type RpcLike } from './rpc.js';
import type { FactAttestor, FactClaim } from './types.js';

export const EVM_TX_CLAIM = 'evm-tx';

const ZERO_ADDR = '0x' + '0'.repeat(40);

interface RawTx {
  from: string;
  to: string | null;
  value: string;
  input?: string;
  data?: string;
  type?: string;
  blockNumber: string | null;
  transactionIndex?: string;
}

interface RawReceipt {
  blockNumber: string;
  status?: string;
}

export class EvmFactAttestor implements FactAttestor {
  readonly label: string;

  constructor(
    private readonly rpc: RpcLike,
    private readonly anchor: AnchorConfig,
  ) {
    this.label = `${anchor.label} JSON-RPC read`;
  }

  async verify(claim: FactClaim): Promise<VerifiedFact> {
    if (claim.claimKind !== EVM_TX_CLAIM) {
      throw new Error(`EvmFactAttestor: unsupported claimKind '${claim.claimKind}' (expected '${EVM_TX_CLAIM}')`);
    }
    const txHash = claim.locator;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error(`EvmFactAttestor: not a 32-byte tx hash: ${txHash}`);
    }

    const chainId = hexToNum((await this.rpc.send('eth_chainId', [])) as string);
    if (chainId !== this.anchor.chainId) {
      throw new Error(
        `EvmFactAttestor: RPC chainId ${chainId} (0x${chainId.toString(16)}) != anchor '${this.anchor.label}' chainId ${this.anchor.chainId} — wrong network or wrong anchor`,
      );
    }

    const tx = (await this.rpc.send('eth_getTransactionByHash', [txHash])) as RawTx | null;
    if (!tx) {
      throw new Error(`EvmFactAttestor: tx ${txHash} not found on ${this.anchor.label}`);
    }
    if (tx.blockNumber == null) {
      throw new Error(`EvmFactAttestor: tx ${txHash} is still pending (no block) — unverifiable`);
    }

    const rcpt = (await this.rpc.send('eth_getTransactionReceipt', [txHash])) as RawReceipt | null;
    if (!rcpt) {
      throw new Error(`EvmFactAttestor: no receipt for ${txHash} on ${this.anchor.label}`);
    }
    if (rcpt.blockNumber !== tx.blockNumber) {
      throw new Error(`EvmFactAttestor: receipt block ${rcpt.blockNumber} != tx block ${tx.blockNumber} for ${txHash}`);
    }

    const head = hexToNum((await this.rpc.send('eth_blockNumber', [])) as string);

    const fact: VerifiedFact = {
      domain: 'payment',
      chainKey: this.anchor.chainId,
      sourceChain: this.anchor.sourceChain,
      headerNumber: hexToNum(rcpt.blockNumber),
      txIndex: tx.transactionIndex == null ? 0 : hexToNum(tx.transactionIndex),
      txHash,
      verified: true,
      verifiedVia: `${this.anchor.label} JSON-RPC read (eth_getTransactionByHash + eth_getTransactionReceipt at head ${head})`,
      from: tx.from,
      to: tx.to ?? ZERO_ADDR,
      valueWei: BigInt(tx.value),
      calldata: tx.input ?? tx.data ?? '0x',
      txType: tx.type == null ? 0 : hexToNum(tx.type),
      receiptStatus: rcpt.status == null ? null : hexToNum(rcpt.status),
      attestedHeight: head,
      factHash: '',
    };
    fact.factHash = computeFactHash({
      chainKey: fact.chainKey,
      headerNumber: fact.headerNumber,
      txHash,
      verified: fact.verified,
    });
    return fact;
  }
}
