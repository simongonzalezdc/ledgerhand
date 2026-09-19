/** Anchor chains — where facts are read and receipts are anchored.
 *
 * ANCHOR RULING (PM-ARENA decisions log, 2026-09-19, P0 exit): the P1 anchor
 * is Arbitrum-Sepolia. At turn start both HyperEVM endpoints were dead from
 * this host (testnet rpc.: TLS failure under both LibreSSL and OpenSSL;
 * canonical api. hostname: HTTP 404; mainnet: 404/empty — see desk receipt
 * for the probe table) while Arbitrum-Sepolia answered every probe under
 * both TLS stacks. This is the desk's pre-ruled fallback firing, not a new
 * track decision: Hyperliquid stays the preferred CONTEST track (re-probe
 * `npm run ledger -- probe` daily; re-anchoring is a config swap —
 * LEDGERHAND_ANCHOR=hyperevm-testnet — because the binding is chain-agnostic).
 */

import { JsonRpcClient, hexToNum, type RpcLike } from './rpc.js';

export interface AnchorConfig {
  label: string;
  rpcUrl: string;
  chainId: number;
  /** VerifiedFact.sourceChain label */
  sourceChain: string;
  /** Free faucet path. USING a faucet requires a wallet address — a CEO-gated
   *  act per the desk's §CEO-GATED list; the path is recorded, not exercised. */
  faucetUrl?: string;
  note?: string;
}

export const ANCHORS: Record<string, AnchorConfig> = {
  'arb-sepolia': {
    label: 'arb-sepolia',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    chainId: 421614, // 0x66eee — verified live 2026-09-19T04:56Z (curl + node fetch)
    sourceChain: 'arbitrum-sepolia',
    faucetUrl: 'https://faucets.chain.link/arbitrum-sepolia', // free, GitHub login; HTTP 200 2026-09-19
    note: 'P1 anchor per the 2026-09-19 ruling (desk DECISIONS LOG).',
  },
  'hyperevm-testnet': {
    label: 'hyperevm-testnet',
    rpcUrl: 'https://rpc.hyperliquid-testnet.xyz/evm',
    chainId: 998, // 0x3e6 — Lead-verified live 2026-09-18T02:0xZ; dead from this Mac 2026-09-19
    sourceChain: 'hyperevm-testnet',
    faucetUrl: 'https://app.hyperliquid-testnet.xyz', // free in-app faucet; HTTP 200 2026-09-19
    note: 'TLS-failing from this Mac on 2026-09-17 and again 2026-09-19 (LibreSSL + OpenSSL both). Canonical ethereum-lists hostname is api.hyperliquid-testnet.xyz/evm — HTTP 404 today. On daily re-probe watch.',
  },
  'hyperevm-mainnet': {
    label: 'hyperevm-mainnet',
    rpcUrl: 'https://api.hyperliquid.xyz/evm',
    chainId: 999, // 0x3e7 — verified live once 2026-09-17; 404/empty since
    sourceChain: 'hyperevm-mainnet',
    note: 'READ-ONLY (fact reads) anchor candidate, never receipts without a fresh green probe + Lead ruling. Unstable from this host: green 2026-09-17, empty ×3 2026-09-18 (Lead), HTTP 404 2026-09-19.',
  },
};

export const DEFAULT_ANCHOR = 'arb-sepolia'; // P0 ruling 2026-09-19 — pinned by test/binding.test.ts

export function resolveAnchor(name?: string): AnchorConfig {
  const key = name ?? process.env.LEDGERHAND_ANCHOR ?? DEFAULT_ANCHOR;
  const anchor = ANCHORS[key];
  if (!anchor) {
    throw new Error(`unknown anchor '${key}' — known: ${Object.keys(ANCHORS).join(', ')}`);
  }
  return anchor;
}

export interface AnchorProbe {
  label: string;
  rpcUrl: string;
  ok: boolean;
  chainId: number | null;
  blockNumber: number | null;
  error?: string;
  probedAt: string;
}

/** Liveness probe: eth_chainId + eth_blockNumber. Read-only, free. */
export async function probeAnchor(anchor: AnchorConfig, rpc: RpcLike = new JsonRpcClient(anchor.rpcUrl)): Promise<AnchorProbe> {
  const base: AnchorProbe = {
    label: anchor.label,
    rpcUrl: anchor.rpcUrl,
    ok: false,
    chainId: null,
    blockNumber: null,
    probedAt: new Date().toISOString(),
  };
  try {
    const chainId = hexToNum((await rpc.send('eth_chainId', [])) as string);
    if (chainId !== anchor.chainId) {
      return { ...base, ok: false, chainId, error: `chainId ${chainId} (0x${chainId.toString(16)}) != configured ${anchor.chainId}` };
    }
    const blockNumber = hexToNum((await rpc.send('eth_blockNumber', [])) as string);
    return { ...base, ok: true, chainId, blockNumber };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
