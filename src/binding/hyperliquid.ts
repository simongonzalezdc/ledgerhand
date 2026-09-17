/** Hyperliquid binding (Phase 1 of the CWF build — PRIMARY track).
 *
 * Track rule (CWF Official Rules §14g): "$100,000 will be awarded across 10
 * of the best products that integrate with Hypercore or HyperEVM."
 *
 * Status (2026-09-17, PM-ARENA):
 *  - HyperEVM mainnet read RPC verified live from this machine:
 *    https://rpc.hyperliquid.xyz/evm → eth_chainId = 0x3e7 (999).
 *  - Official TESTNET endpoint (rpc.hyperliquid-testnet.xyz/evm) failed TLS
 *    handshake twice from this Mac on 2026-09-17 — resolve in Phase 0/1
 *    (retry, alternate providers) or fall back to another EVM track
 *    (Arbitrum, per desk ruling) for the anchored-on-testnet leg.
 *
 * Phase 1 implements FactAttestor (verify a HyperEVM payment tx via receipt
 * eth_call reads → VerifiedFact) and ReceiptAnchor (deploy/submit to
 * QuorumRegistry on HyperEVM testnet).
 */

export const HYPEREVM_MAINNET_RPC = 'https://rpc.hyperliquid.xyz/evm';
export const HYPEREVM_MAINNET_CHAIN_ID = 999; // 0x3e7, verified 2026-09-17

/** HyperEVM FactAttestor + ReceiptAnchor — Phase 1 (tracked in PM-ARENA desk). */
