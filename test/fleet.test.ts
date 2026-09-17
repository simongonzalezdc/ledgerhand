/**
 * Offline quorum/certificate suite — ported from QuorumProof
 * (buidl-ctc @ 8ba592e, test/fleet.test.ts) to the Ledgerhand core.
 * Import surface changed only: gateway hashing → core/policy, pipeline demo →
 * src/demo. All assertions preserved.
 */
import { describe, expect, it } from 'vitest';
import { Fleet, auditCertificateSignatures } from '../src/core/fleet.js';
import { DETERMINISTIC_FLEET } from '../src/core/brains.js';
import { computeFactHash, computePolicyId } from '../src/core/policy.js';
import { demoFact, demoPolicy } from '../src/demo.js';
import type { Policy, VerifiedFact } from '../src/core/types.js';
import { eip191Digest, splitSignature, voteDigest, VOTE_BYTE } from '../src/core/certificate.js';
import { getBytes, hashMessage, verifyMessage, Wallet } from 'ethers';

function fakeFact(overrides: Partial<VerifiedFact> = {}): VerifiedFact {
  return demoFact(overrides);
}

function policy(): Policy {
  return demoPolicy();
}

describe('hashing', () => {
  it('factHash and policyId are deterministic', () => {
    const f = fakeFact();
    expect(f.factHash).toBe(fakeFact().factHash);
    expect(computePolicyId(policy())).toBe(computePolicyId(policy()));
    expect(computePolicyId({ ...policy(), expectedAmountWei: 1n })).not.toBe(computePolicyId(policy()));
  });

  it('voteDigest + splitSignature round-trip and match EIP-191', async () => {
    const w = Wallet.createRandom();
    const digest = voteDigest({
      factHash: fakeFact().factHash,
      policyId: computePolicyId(policy()),
      round: 2,
      agentId: 'ledger-01',
      vote: 'APPROVE',
    });
    const sig = await w.signMessage(digest);
    const { r, s, v } = splitSignature(sig);
    expect(r.length).toBe(66);
    expect(s.length).toBe(66);
    expect([27, 28]).toContain(v);
    expect(verifyMessage(digest, sig).toLowerCase()).toBe(w.address.toLowerCase());
    // our eip191Digest matches ethers' hashMessage, and the signature recovers
    // over the RAW digest exactly the way QuorumRegistry (ecrecover) will.
    expect(eip191Digest(digest)).toBe(hashMessage(getBytes(digest)));
    expect(verifyMessage(digest, sig).toLowerCase()).toBe(w.address.toLowerCase());
  });

  it('vote bytes match the Solidity registry enum', () => {
    expect(VOTE_BYTE.ABSTAIN).toBe(0);
    expect(VOTE_BYTE.APPROVE).toBe(1);
    expect(VOTE_BYTE.DENY).toBe(2);
  });
});

describe('fleet quorum', () => {
  it('policy-matching payment reaches EXECUTE with unanimous approval', async () => {
    const fleet = new Fleet();
    const trace = await fleet.deliberate(fakeFact(), policy());
    expect(trace.certificate.decision).toBe('EXECUTE');
    expect(trace.certificate.quorum.approvals).toBe(3);
    const audit = auditCertificateSignatures(trace);
    expect(audit.ok).toBe(true);
  });

  it('unrelated inflow is REJECTed with a documented sole dissent', async () => {
    const fleet = new Fleet();
    const trace = await fleet.deliberate(
      fakeFact({ to: '0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0', valueWei: 56_869_366_459_299_350n }),
      policy(),
    );
    expect(trace.certificate.decision).toBe('REJECT');
    const r1 = trace.rounds[0]!.votes.find((v) => v.agentId === 'sentinel-02')!;
    const r2 = trace.rounds[1]!.votes.find((v) => v.agentId === 'sentinel-02')!;
    expect(r1.vote).toBe('APPROVE');
    expect(r2.vote).toBe('APPROVE');
    // sentinel discounts confidence as sole dissent, and says so
    expect(r2.confidence).toBeLessThan(r1.confidence);
    expect(r2.reasons.join(' ')).toMatch(/sole dissent/i);
    expect(auditCertificateSignatures(trace).ok).toBe(true);
  });

  it('underpayment in the dust-to-window gap is blocked by quorum (1/3)', async () => {
    const fleet = new Fleet();
    // 1 ETH to the right payee is a real payment but far below the 3.6 ETH window:
    // ledger DENY (window), sentinel APPROVE (no anomalies), meridian DENY (below window).
    const trace = await fleet.deliberate(fakeFact({ valueWei: 1_000_000_000_000_000_000n }), policy());
    expect(trace.certificate.decision).toBe('REJECT');
    expect(trace.certificate.quorum.approvals).toBe(1);
    const m2 = trace.rounds[1]!.votes.find((v) => v.agentId === 'meridian-03')!;
    expect(m2.vote).toBe('DENY');
  });

  it('meridian revision rule: sole DENY softens to ABSTAIN under a unified approving fleet', async () => {
    // Drive the brain directly with a crafted round-2 context (this state is not
    // reachable with the default deterministic fleet — it is reachable when a
    // fourth LLM analyst joins — but the rule itself must hold).
    const meridian = DETERMINISTIC_FLEET.find((b) => b.id === 'meridian-03')!;
    const fact = fakeFact({ to: '0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0', valueWei: 1_000_000_000_000_000_000n });
    const ctx = {
      fact,
      policy: policy(),
      round: 2 as const,
      summary: { approvals: 2, denials: 0, abstentions: 1, ballotBoxHash: '0x' + '11'.repeat(32) },
      ownRound1: [
        { agentId: 'meridian-03', agentKind: 'deterministic' as const, agentAddress: '0x1', vote: 'DENY' as const, confidence: 0.7, reasons: ['x'], round: 1 as const },
      ],
    };
    const r2 = await meridian.evaluate(ctx);
    expect(r2.vote).toBe('ABSTAIN');
    expect(r2.reasons.join(' ')).toMatch(/conceding/i);
  });

  it('reverted source tx blocks execution', async () => {
    const fleet = new Fleet();
    const trace = await fleet.deliberate(fakeFact({ receiptStatus: 0 }), policy());
    expect(trace.certificate.decision).toBe('REJECT');
  });

  it('certificates bind to the fact: a different fact yields a different factHash and certHash', async () => {
    const fleet = new Fleet();
    const a = await fleet.deliberate(fakeFact(), policy());
    const b = await fleet.deliberate(
      fakeFact({
        txHash: '0x' + 'cd'.repeat(32),
        factHash: computeFactHash({ chainKey: 3, headerNumber: 25_914_979, txHash: '0x' + 'cd'.repeat(32), verified: true }),
      }),
      policy(),
    );
    expect(b.certificate.factHash).not.toBe(a.certificate.factHash);
    expect(b.certificate.certHash).not.toBe(a.certificate.certHash);
  });
});

describe('audit', () => {
  it('detects tampered ballots', async () => {
    const fleet = new Fleet();
    const trace = await fleet.deliberate(fakeFact(), policy());
    const tampered = structuredClone(trace);
    // flip ledger-01's round-2 vote without its signature covering the change
    tampered.certificate.votes = tampered.certificate.votes.map((v) =>
      v.agentId === 'ledger-01' && v.round === 2 ? { ...v, vote: 'DENY' as const } : v,
    );
    const audit = auditCertificateSignatures(tampered);
    expect(audit.ok).toBe(false);
    expect(audit.failures.length).toBeGreaterThan(0);
  });
});
