/** Binding seam suite — anchors, EVM fact attestation (mocked RPC), receipt
 *  book, and the offline QuorumRegistry submit rehearsal. All offline: the
 *  live chain is exercised by the CLI (`npm run ledger -- probe|verify`),
 *  not by unit tests. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbiCoder, keccak256 } from 'ethers';
import { Fleet, auditCertificateSignatures } from '../src/core/fleet.js';
import { computeFactHash } from '../src/core/policy.js';
import { demoFact, demoPolicy } from '../src/demo.js';
import { ANCHORS, DEFAULT_ANCHOR, resolveAnchor } from '../src/binding/anchors.js';
import { EVM_TX_CLAIM, EvmFactAttestor } from '../src/binding/evm.js';
import { LocalReceiptAnchor } from '../src/binding/local.js';
import type { RpcLike } from '../src/binding/rpc.js';
import { buildSubmitArgs, rehearsalRecovery } from '../src/binding/registry.js';
import { agentIdHash, certificateHash, splitSignature, VOTE_BYTE, voteDigest } from '../src/core/certificate.js';

describe('anchors', () => {
  it('pins the P0 ruling: default anchor is arb-sepolia (2026-09-19 decision)', () => {
    expect(DEFAULT_ANCHOR).toBe('arb-sepolia');
    expect(resolveAnchor(undefined).label).toBe('arb-sepolia');
    expect(resolveAnchor('arb-sepolia').chainId).toBe(421614);
  });

  it('carries the Hyperliquid candidates with their verified chainIds', () => {
    expect(ANCHORS['hyperevm-testnet']!.chainId).toBe(998);
    expect(ANCHORS['hyperevm-mainnet']!.chainId).toBe(999);
  });

  it('rejects unknown anchors', () => {
    expect(() => resolveAnchor('nope')).toThrow(/unknown anchor/);
  });
});

/** Deterministic mock RPC serving one canned tx + receipt. */
function mockRpc(overrides: Record<string, unknown> = {}): RpcLike {
  const txHash = '0x' + 'ab'.repeat(32);
  const calls: { method: string; params: unknown[] }[] = [];
  const table: Record<string, unknown> = {
    eth_chainId: '0x66eee',
    eth_blockNumber: '0x1280a800',
    eth_getTransactionByHash: {
      from: '0x9395704E478EB664D5Eb58ecfcf7031724cF367B',
      to: '0x172AC97E50915292F2B3E8B56f6b4DDf80aC0489',
      value: '0x31f2ce4b7ec0000', // 3.5999664 ETH
      input: '0x',
      type: '0x2',
      blockNumber: '0x1280a700',
      transactionIndex: '0x17',
    },
    eth_getTransactionReceipt: { blockNumber: '0x1280a700', status: '0x1' },
    ...overrides,
  };
  return {
    async send(method, params) {
      calls.push({ method, params });
      const v = table[method];
      if (typeof v === 'function') return v(params);
      return v;
    },
  };
}

describe('EvmFactAttestor', () => {
  it('turns a chain read into a VerifiedFact with the canonical factHash', async () => {
    const anchor = resolveAnchor('arb-sepolia');
    const a = new EvmFactAttestor(mockRpc(), anchor);
    const txHash = '0x' + 'ab'.repeat(32);
    const fact = await a.verify({ claimKind: EVM_TX_CLAIM, locator: txHash });
    expect(fact.chainKey).toBe(421614);
    expect(fact.sourceChain).toBe('arbitrum-sepolia');
    expect(fact.headerNumber).toBe(0x1280a700);
    expect(fact.txIndex).toBe(0x17);
    expect(fact.receiptStatus).toBe(1);
    expect(fact.txType).toBe(2);
    expect(fact.valueWei).toBe(0x31f2ce4b7ec0000n);
    expect(fact.verified).toBe(true);
    expect(fact.verifiedVia).toContain('arb-sepolia');
    expect(fact.factHash).toBe(computeFactHash({ chainKey: 421614, headerNumber: 0x1280a700, txHash, verified: true }));
  });

  it('carries a reverted receipt as a verified fact with receiptStatus 0 (fleet denies, attester does not drop it)', async () => {
    const a = new EvmFactAttestor(mockRpc({ eth_getTransactionReceipt: { blockNumber: '0x1280a700', status: '0x0' } }), resolveAnchor('arb-sepolia'));
    const fact = await a.verify({ claimKind: EVM_TX_CLAIM, locator: '0x' + 'ab'.repeat(32) });
    expect(fact.verified).toBe(true);
    expect(fact.receiptStatus).toBe(0);
  });

  it('refuses a pending tx (no block)', async () => {
    const a = new EvmFactAttestor(mockRpc({ eth_getTransactionByHash: { blockNumber: null } }), resolveAnchor('arb-sepolia'));
    await expect(a.verify({ claimKind: EVM_TX_CLAIM, locator: '0x' + 'ab'.repeat(32) })).rejects.toThrow(/pending/);
  });

  it('refuses an unknown tx', async () => {
    const a = new EvmFactAttestor(mockRpc({ eth_getTransactionByHash: null }), resolveAnchor('arb-sepolia'));
    await expect(a.verify({ claimKind: EVM_TX_CLAIM, locator: '0x' + 'ab'.repeat(32) })).rejects.toThrow(/not found/);
  });

  it('refuses a wrong-network RPC', async () => {
    const a = new EvmFactAttestor(mockRpc({ eth_chainId: '0x3e7' }), resolveAnchor('arb-sepolia'));
    await expect(a.verify({ claimKind: EVM_TX_CLAIM, locator: '0x' + 'ab'.repeat(32) })).rejects.toThrow(/wrong network/);
  });

  it('refuses non-tx claims and non-hashes', async () => {
    const a = new EvmFactAttestor(mockRpc(), resolveAnchor('arb-sepolia'));
    await expect(a.verify({ claimKind: 'solana-tx', locator: '0x' + 'ab'.repeat(32) })).rejects.toThrow(/claimKind/);
    await expect(a.verify({ claimKind: EVM_TX_CLAIM, locator: 'nothash' })).rejects.toThrow(/tx hash/);
  });
});

describe('LocalReceiptAnchor', () => {
  it('appends auditable receipts to an append-only ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledgerhand-test-'));
    try {
      const ledger = join(dir, 'receipts', 'ledger.jsonl');
      const fleet = new Fleet({ chainLabel: 'arb-sepolia' });
      const anchor = new LocalReceiptAnchor(ledger);
      const t1 = await fleet.deliberate(demoFact(), demoPolicy());
      const r1 = await anchor.anchor(t1);
      const t2 = await fleet.deliberate(demoFact({ txHash: '0x' + 'cd'.repeat(32), factHash: computeFactHash({ chainKey: 3, headerNumber: 25_914_979, txHash: '0x' + 'cd'.repeat(32), verified: true }) }), demoPolicy());
      const r2 = await anchor.anchor(t2);
      expect(r1.txHash).toBe(`local:${t1.certificate.certHash}`);
      expect(r1.registry).toBe(ledger);
      const lines = readFileSync(ledger, 'utf8').trim().split('\n');
      expect(lines.length).toBe(2);
      const first = JSON.parse(lines[0]!) as { certHash: string; decision: string; chain: string; ballots: unknown[] };
      expect(first.certHash).toBe(t1.certificate.certHash);
      expect(first.decision).toBe('EXECUTE');
      expect(first.chain).toBe('arb-sepolia');
      expect(first.ballots.length).toBe(3);
      expect(r2.txHash).not.toBe(r1.txHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QuorumRegistry submit encoding (offline rehearsal of the on-chain leg)', () => {
  it('submits exactly the round-2 ballots with signers and vote bytes', async () => {
    const fleet = new Fleet({ chainLabel: 'arb-sepolia' });
    const trace = await fleet.deliberate(demoFact(), demoPolicy());
    const a = buildSubmitArgs(trace);
    const r2 = trace.certificate.votes.filter((v) => v.round === 2);
    expect(a.agentIds.length).toBe(r2.length);
    expect(a.signers.length).toBe(r2.length);
    for (let i = 0; i < r2.length; i++) {
      const v = r2[i]!;
      expect(a.agentIds[i]).toBe(agentIdHash(v.agentId));
      expect(a.signers[i]).toBe(v.agentAddress);
      expect(a.votes[i]).toBe(VOTE_BYTE[v.vote]);
      const sig = splitSignature(v.signature!);
      expect(a.r[i]).toBe(sig.r);
      expect(a.s[i]).toBe(sig.s);
      expect(a.v[i]).toBe(sig.v);
      expect([27, 28]).toContain(a.v[i]!);
    }
    expect(a.decision).toBe(1);
    expect(a.requiredApprovals).toBe(trace.certificate.quorum.required);
  });

  it('round-2 signatures recover over the contract digest (what ecrecover will check)', async () => {
    const fleet = new Fleet({ chainLabel: 'arb-sepolia' });
    const trace = await fleet.deliberate(demoFact(), demoPolicy());
    expect(rehearsalRecovery(trace).ok).toBe(true);
    expect(auditCertificateSignatures(trace).ok).toBe(true);
  });

  it('voteDigest byte-layout equals abi.encode (32-byte words) — matches the fixed contract', () => {
    // contracts/QuorumRegistry.sol (2026-09-19 fix): keccak256(abi.encode(...)).
    // Independent construction: static words in abi.encode are simply
    // concatenated 32-byte big-endian words.
    const factHash = demoFact().factHash;
    const policyId = demoFact().factHash; // any bytes32
    const digest = voteDigest({ factHash, policyId, round: 2, agentId: 'ledger-01', vote: 'APPROVE' });
    const word = (n: number | bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    const manual = keccak256(
      Buffer.concat([
        Buffer.from(factHash.slice(2), 'hex'),
        Buffer.from(policyId.slice(2), 'hex'),
        word(2),
        Buffer.from(agentIdHash('ledger-01').slice(2), 'hex'),
        word(VOTE_BYTE.APPROVE),
      ]),
    );
    expect(digest).toBe(manual);
    expect(digest).toBe(
      keccak256(new AbiCoder().encode(['bytes32', 'bytes32', 'uint8', 'bytes32', 'uint8'], [factHash, policyId, 2, agentIdHash('ledger-01'), VOTE_BYTE.APPROVE])),
    );
  });

  it('certificateHash byte-layout matches the fixed contract (string head/tail + 5 static words)', () => {
    const h = certificateHash({ factHash: demoFact().factHash, policyId: demoFact().factHash, decision: 'EXECUTE', approvals: 3, fleetSize: 3 });
    // Independent construction of keccak256(abi.encode("QUORUMPROOF_V1", factHash,
    // policyId, decision, approvals, fleetSize)): dynamic string first → head
    // = offset word (past all 6 head words = 0xc0) + static words, tail =
    // string length word + padded data. Verified against ethers' encoder
    // byte-for-byte on 2026-09-19 (PM-ARENA P1).
    const factHash = demoFact().factHash;
    const policyId = demoFact().factHash;
    const str = 'QUORUMPROOF_V1';
    const word = (n: number | bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    const strData = Buffer.from(str, 'utf8');
    const padded = Buffer.concat([strData, Buffer.alloc(32 - (strData.length % 32))]);
    const head = Buffer.concat([word(0xc0), Buffer.from(factHash.slice(2), 'hex'), Buffer.from(policyId.slice(2), 'hex'), word(1), word(3), word(3)]);
    const manual = keccak256(Buffer.concat([head, word(strData.length), padded]));
    expect(h).toBe(manual);
  });
});
