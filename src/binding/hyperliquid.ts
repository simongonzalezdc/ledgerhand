/** Hyperliquid binding (PRIMARY contest track — CWF build).
 *
 * Track rule (CWF Official Rules §14g): "$100,000 will be awarded across 10
 * of the best products that integrate with Hypercore or HyperEVM."
 *
 * Status (updated 2026-09-19, PM-ARENA P0 exit — probe table on the desk):
 *  - rpc.hyperliquid-testnet.xyz/evm  DEAD from this Mac 2026-09-17 AND
 *    2026-09-19: TLS handshake failure under both LibreSSL (curl) and
 *    OpenSSL (node fetch). Lead saw it live once (0x3e6) on 09-18.
 *  - api.hyperliquid-testnet.xyz/evm  (canonical per ethereum-lists chain
 *    998): HTTP 404 / empty body on 2026-09-19.
 *  - api.hyperliquid.xyz/evm (mainnet, 0x3e7): green once 2026-09-17,
 *    empty ×3 on 09-18 (Lead), HTTP 404 on 09-19 — unstable from this host.
 *  - Third-party HyperEVM RPCs (dRPC, Alchemy, …) exist but ALL require
 *    account/API-key registration — barred (no external accounts).
 *
 * RULING (desk DECISIONS LOG 2026-09-19): the P1 anchor is Arbitrum-Sepolia
 * (Hyperliquid's pre-ruled fallback — Hyperliquid stays the preferred
 * CONTEST track, re-verified submission day). The binding is chain-agnostic:
 * re-anchor by LEDGERHAND_ANCHOR=hyperevm-testnet when a daily probe
 * (`npm run ledger -- probe hyperevm-testnet`) goes green. Config now lives
 * in ./anchors.ts (chainIds 998/999/421614); this file keeps the track note.
 */
