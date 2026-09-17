/**
 * Fleet orchestrator: two-round deliberation with a quorum gate.
 *
 * Round 1 — independent secret ballot. Each brain evaluates the verified fact
 *           on its own; votes are committed (keccak ballot-box hash) before
 *           anyone sees anyone else's vote.
 * Round 2 — visible debate. The round-1 tally + ballot-box hash are published;
 *           every brain may revise its vote exactly once, with reasons. A brain
 *           whose vote is alone against a unified fleet faces the strongest
 *           social proof and may concede; a unanimous fleet stays put.
 * Gate    — EXECUTE iff approvals >= quorumNumerator AND mean approval
 *           confidence >= 0.5; else REJECT. Either way the outcome is a signed
 *           QuorumCertificate bound to the factHash.
 *
 * Extracted from QuorumProof (buidl-ctc @ 8ba592e, src/agents/fleet.ts).
 * Generalized: policy hashing now lives in the core (./policy.ts), the
 * certificate's chain field is a binding label, and the fleet composition /
 * quorum config are constructor inputs (defaults unchanged).
 */
import { keccak256, verifyMessage, HDNodeWallet, Wallet } from 'ethers';
import type {
  Brain,
} from './brains.js';
import { DETERMINISTIC_FLEET, makeLlmBrain } from './brains.js';
import type {
  DeliberationTrace,
  Policy,
  QuorumCertificate,
  RoundSummary,
  Vote,
} from './types.js';
import { computePolicyId } from './policy.js';
import { certificateHash, voteDigest } from './certificate.js';
import { LLM_API_KEY, LLM_MODEL, LLM_URL } from './config.js';

export interface QuorumConfig {
  /** fleet members required to APPROVE for EXECUTE */
  requiredApprovals: number;
  /** minimum mean confidence among approvals */
  minMeanConfidence: number;
}

export const DEFAULT_QUORUM: QuorumConfig = { requiredApprovals: 2, minMeanConfidence: 0.5 };

/** Label recorded on certificates — the enforcement domain this fleet serves. */
export const DEFAULT_CHAIN_LABEL = 'local';

export function defaultFleet(): Brain[] {
  if (LLM_URL && LLM_MODEL && LLM_API_KEY) {
    // LLM analyst REPLACES no one — it ADDS a fourth vote; quorum still 2-of-N.
    return [...DETERMINISTIC_FLEET, makeLlmBrain({ url: LLM_URL, model: LLM_MODEL, apiKey: LLM_API_KEY })];
  }
  return DETERMINISTIC_FLEET;
}

/** keccak256 over the votes as committed ballots (order-independent via sorting). */
function ballotBox(votes: Vote[]): string {
  const commits = votes
    .map((v) => `${v.agentId}:${v.vote}:${v.confidence.toFixed(3)}:${v.reasons.join('|')}`)
    .sort()
    .join(';');
  return keccak256(Buffer.from(commits, 'utf8'));
}

interface AgentIdentity {
  brain: Brain;
  wallet: HDNodeWallet;
}

export class Fleet {
  private readonly identities: AgentIdentity[];
  readonly quorum: QuorumConfig;
  readonly chainLabel: string;

  constructor(
    opts: {
      brains?: Brain[];
      quorum?: QuorumConfig;
      chainLabel?: string;
    } = {},
  ) {
    this.identities = (opts.brains ?? defaultFleet()).map((brain) => ({
      brain,
      // One ephemeral secp256k1 identity per agent, created at fleet spawn.
      // These sign the ballots; the QuorumRegistry contract recovers them on-chain.
      wallet: Wallet.createRandom(),
    }));
    this.quorum = opts.quorum ?? DEFAULT_QUORUM;
    this.chainLabel = opts.chainLabel ?? DEFAULT_CHAIN_LABEL;
  }

  get roster(): { agentId: string; agentAddress: string; charter: string; kind: string }[] {
    return this.identities.map((i) => ({
      agentId: i.brain.id,
      agentAddress: i.wallet.address,
      charter: i.brain.charter,
      kind: i.brain.kind,
    }));
  }

  private async collectSigned(
    round: 1 | 2,
    ctxBase: { fact: DeliberationTrace['fact']; policy: Policy; summary?: RoundSummary; ownRound1?: Vote[] },
  ): Promise<{ votes: Vote[]; boxHash: string }> {
    const votes: Vote[] = [];
    for (const { brain, wallet } of this.identities) {
      const partial = await brain.evaluate({
        fact: ctxBase.fact,
        policy: ctxBase.policy,
        round,
        summary: ctxBase.summary,
        ownRound1: ctxBase.ownRound1,
      });
      const digest = voteDigest({
        factHash: ctxBase.fact.factHash,
        policyId: computePolicyId(ctxBase.policy),
        round,
        agentId: brain.id,
        vote: partial.vote,
      });
      const signature = await wallet.signMessage(digest);
      votes.push({
        ...partial,
        agentAddress: wallet.address,
        round,
        signature,
      });
    }
    return { votes, boxHash: ballotBox(votes) };
  }

  async deliberate(
    fact: DeliberationTrace['fact'],
    policy: Policy,
  ): Promise<DeliberationTrace> {
    const t0 = Date.now();
    const policyId = computePolicyId(policy);

    // ROUND 1 — secret ballot
    const round1 = await this.collectSigned(1, { fact, policy });
    const summary: RoundSummary = {
      approvals: round1.votes.filter((v) => v.vote === 'APPROVE').length,
      denials: round1.votes.filter((v) => v.vote === 'DENY').length,
      abstentions: round1.votes.filter((v) => v.vote === 'ABSTAIN').length,
      ballotBoxHash: round1.boxHash,
    };

    // ROUND 2 — debate: each brain sees the published tally AND its own
    // round-1 ballot, and may revise once under its documented revision rule.
    const round2 = await this.collectSigned(2, {
      fact,
      policy,
      summary,
      ownRound1: round1.votes,
    });

    const allVotes = [...round1.votes, ...round2.votes];
    const finalVotes = round2.votes;

    const approvals = finalVotes.filter((v) => v.vote === 'APPROVE');
    const denials = finalVotes.filter((v) => v.vote === 'DENY');
    const abstentions = finalVotes.filter((v) => v.vote === 'ABSTAIN');

    const meanConf =
      approvals.length > 0
        ? approvals.reduce((s, v) => s + v.confidence, 0) / approvals.length
        : 0;
    const quorumMet =
      approvals.length >= this.quorum.requiredApprovals && meanConf >= this.quorum.minMeanConfidence;
    const decision = quorumMet ? 'EXECUTE' : 'REJECT';

    const cert: QuorumCertificate = {
      factHash: fact.factHash,
      policyId,
      txLabel: fact.txHash,
      decision,
      quorum: {
        approvals: approvals.length,
        denials: denials.length,
        abstentions: abstentions.length,
        fleetSize: finalVotes.length,
        required: this.quorum.requiredApprovals,
      },
      votes: allVotes,
      certHash: '',
      createdAt: new Date().toISOString(),
      chain: this.chainLabel,
    };
    cert.certHash = certificateHash({
      factHash: cert.factHash,
      policyId: cert.policyId,
      decision: cert.decision,
      approvals: cert.quorum.approvals,
      fleetSize: cert.quorum.fleetSize,
    });

    return {
      fact,
      policy,
      policyId,
      rounds: [
        { round: 1, votes: round1.votes },
        { round: 2, votes: round2.votes },
      ],
      ballotBoxHash: round2.boxHash,
      certificate: cert,
      timings: { proofMs: 0, verifyMs: 0, decodeMs: 0, deliberateMs: Date.now() - t0 },
    };
  }
}

/** Verify every ballot signature in a certificate (local audit). */
export function auditCertificateSignatures(trace: DeliberationTrace): {
  ok: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const vote of trace.certificate.votes) {
    if (!vote.signature) {
      failures.push(`${vote.agentId} round ${vote.round}: missing signature`);
      continue;
    }
    const commitHash = voteDigest({
      factHash: trace.fact.factHash,
      policyId: trace.policyId,
      round: vote.round,
      agentId: vote.agentId,
      vote: vote.vote,
    });
    try {
      const recovered = verifyMessage(commitHash, vote.signature);
      if (recovered.toLowerCase() !== vote.agentAddress.toLowerCase()) {
        failures.push(`${vote.agentId} round ${vote.round}: signer mismatch`);
      }
    } catch (e) {
      failures.push(`${vote.agentId} round ${vote.round}: bad signature (${(e as Error).message})`);
    }
  }
  return { ok: failures.length === 0, failures };
}
