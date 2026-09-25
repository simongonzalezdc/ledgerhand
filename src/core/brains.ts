/**
 * Agent brains. Each is a distinct analytic posture over the SAME verified
 * fact — heterogeneous by design so that quorum is a meaningful check, not
 * three copies of one opinion.
 *
 * Default brains are deterministic analytic evaluators (auditable, offline,
 * zero-cost). An optional LLM brain can be enabled with any OpenAI-compatible
 * endpoint via LEDGERHAND_LLM_URL / LEDGERHAND_LLM_MODEL / LEDGERHAND_LLM_API_KEY;
 * without it the fleet runs fully self-contained.
 *
 * Extracted from QuorumProof (buidl-ctc @ 8ba592e, src/agents/brains.ts);
 * mandates and revision rules unchanged. Product layers (e.g. the Hyperliquid
 * binding) compose additional brains alongside this reference fleet.
 */
import type { Policy, RoundSummary, VerifiedFact, Vote, VoteKind } from './types.js';

export interface BrainContext {
  fact: VerifiedFact;
  policy: Policy;
  round: 1 | 2;
  /** Present in round 2: what round 1 produced (secret ballot until then) */
  summary?: RoundSummary;
  /** Present in round 2: this agent's own round-1 ballots (single element) */
  ownRound1?: Vote[];
}

export interface Brain {
  id: string;
  kind: 'deterministic' | 'llm';
  /** One-line charter, shown in the audit trail */
  charter: string;
  evaluate(ctx: BrainContext): Promise<Omit<Vote, 'agentAddress' | 'signature' | 'round'>>;
}

function within(
  v: bigint,
  lo: bigint,
  hi: bigint,
): boolean {
  return v >= lo && v <= hi;
}

/** acceptable payment window in wei given the policy tolerances */
export function acceptableWindow(p: Policy): { minWei: bigint; maxWei: bigint } {
  const e = p.expectedAmountWei;
  const min = e - (e * BigInt(p.shortfallToleranceBps)) / 10000n;
  const max = e + (e * BigInt(p.overpayToleranceBps)) / 10000n;
  return { minWei: min < 0n ? 0n : min, maxWei: max };
}

const LEDGER: Brain = {
  id: 'ledger-01',
  kind: 'deterministic',
  charter: 'Conservative underwriter: exact-policy compliance or nothing.',
  async evaluate({ fact, policy }) {
    const reasons: string[] = [];

    if (fact.receiptStatus !== null && fact.receiptStatus !== 1) {
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.95, reasons: [`source receipt status ${fact.receiptStatus}: the verified transaction reverted`] };
    }
    if (fact.to.toLowerCase() !== policy.payee.toLowerCase()) {
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.9, reasons: [`recipient ${fact.to} is not the policy payee ${policy.payee}`] };
    }
    if (fact.from.toLowerCase() === policy.payee.toLowerCase()) {
      // P2 eval finding S09 (evals/scenarios.json): a transfer funded by the
      // payee itself is a wash, not a policy payment — the underwriter rules
      // on policy compliance, and compliance requires an external payer.
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.88, reasons: [`payer ${fact.from} is the policy payee — a self-directed transfer is not a payment under this policy`] };
    }
    const { minWei, maxWei } = acceptableWindow(policy);
    if (!within(fact.valueWei, minWei, maxWei)) {
      return {
        agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.85,
        reasons: [
          `payment ${Number(fact.valueWei) / 1e18} ETH outside acceptable window [${Number(minWei) / 1e18}, ${Number(maxWei) / 1e18}] ETH`,
        ],
      };
    }
    reasons.push(`recipient matches policy payee`);
    reasons.push(`amount ${Number(fact.valueWei) / 1e18} ETH within tolerated window`);
    reasons.push(`fact verified via ${fact.verifiedVia}`);
    return { agentId: this.id, agentKind: this.kind, vote: 'APPROVE', confidence: 0.86, reasons };
  },
};

const SENTINEL: Brain = {
  id: 'sentinel-02',
  kind: 'deterministic',
  charter: 'Fraud & anomaly control: rules on transaction integrity only, never on policy fit.',
  async evaluate({ fact, round, summary, ownRound1 }) {
    const reasons: string[] = [];

    if (fact.receiptStatus === 0) {
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.93, reasons: ['verified transaction reverted on source chain'] };
    }
    if (fact.valueWei === 0n) {
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.8, reasons: ['zero-value transaction: nothing of economic substance was transferred'] };
    }
    if (fact.from.toLowerCase() === fact.to.toLowerCase()) {
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.82, reasons: ['self-transfer: counterparty and beneficiary are the same address'] };
    }
    if (fact.calldata !== '0x' && fact.calldata !== '') {
      reasons.push('calldata present: plain-value payment expected, contract interaction flagged for review');
    }
    reasons.push(`no anomalies: value ${Number(fact.valueWei) / 1e18} ETH, distinct counterparties, status ${fact.receiptStatus ?? 'unknown'}`);

    // Round-2 revision rule (documented): as sole approver facing a fleet that
    // declined, Sentinel maintains its dissent but discounts confidence — its
    // mandate is integrity, and it defers jurisdiction over policy fit.
    if (round === 2 && summary && ownRound1) {
      const mine = ownRound1.find((v) => v.agentId === this.id);
      if (mine?.vote === 'APPROVE' && summary.approvals === 1 && summary.denials >= 2) {
        reasons.push('sole dissent maintained: mandate is transaction integrity; policy fit belongs to ledger/meridian');
        return { agentId: this.id, agentKind: this.kind, vote: 'APPROVE', confidence: 0.66, reasons };
      }
    }
    return { agentId: this.id, agentKind: this.kind, vote: 'APPROVE', confidence: 0.74, reasons };
  },
};

const MERIDIAN: Brain = {
  id: 'meridian-03',
  kind: 'deterministic',
  charter: 'Market & timing analyst: partial payments get weighted, not zeroed.',
  async evaluate({ fact, policy, round, summary, ownRound1 }) {
    const reasons: string[] = [];
    const { minWei, maxWei } = acceptableWindow(policy);

    if (fact.receiptStatus !== null && fact.receiptStatus !== 1) {
      return { agentId: this.id, agentKind: this.kind, vote: 'ABSTAIN', confidence: 0.5, reasons: ['reverted tx — outside my mandate, deferring to ledger/sentinel'] };
    }
    if (fact.valueWei >= minWei && fact.valueWei <= maxWei && fact.to.toLowerCase() === policy.payee.toLowerCase()) {
      // P2 eval finding S05: coverage must be checked against BOTH window
      // edges — an overpay beyond tolerance is as noncompliant as a shortfall.
      const ratio = Number(fact.valueWei) / Number(policy.expectedAmountWei);
      const confidence = Math.max(0.5, Math.min(0.9, 0.55 + 0.35 * Math.min(1, ratio)));
      reasons.push(`recipient correct; coverage ratio ${(ratio * 100).toFixed(2)}% of expected`);
      reasons.push(`verification depth: source block ${fact.headerNumber} vs attested height ${fact.attestedHeight ?? 'n/a'}`);
      return { agentId: this.id, agentKind: this.kind, vote: 'APPROVE', confidence, reasons };
    }
    if (fact.valueWei >= policy.minAmountWei) {
      reasons.push('material payment observed but policy match incomplete — recommend restructuring, not execution');
      // Round-2 revision rule (documented): a sole DENY against a unified
      // approving fleet softens to ABSTAIN — concede the floor, not the point.
      if (round === 2 && summary && ownRound1) {
        const mine = ownRound1.find((v) => v.agentId === this.id);
        if (mine?.vote === 'DENY' && summary.approvals >= 2) {
          reasons.push('conceding to fleet majority: objection recorded as abstention');
          return { agentId: this.id, agentKind: this.kind, vote: 'ABSTAIN', confidence: 0.6, reasons };
        }
      }
      return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.7, reasons };
    }
    reasons.push('payment below dust floor — no economic basis to execute');
    return { agentId: this.id, agentKind: this.kind, vote: 'DENY', confidence: 0.7, reasons };
  },
};

export const DETERMINISTIC_FLEET: Brain[] = [LEDGER, SENTINEL, MERIDIAN];

export interface LlmBrainOpts {
  url: string;
  model: string;
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout (default 30s — local inference can be slow). */
  timeoutMs?: number;
}

/**
 * Optional LLM analyst (round-trip to any OpenAI-compatible endpoint).
 * Exported so product layers can add it alongside the deterministic fleet.
 *
 * P2 (2026-09-25): the analyst now SEES the round-2 debate (published tally +
 * its own round-1 ballot) like every other brain, carries a request timeout,
 * and retries once on transport/5xx failures. Vote output is still coerced to
 * the strict {vote, confidence, reasons} contract before it can enter a ballot.
 */
export function makeLlmBrain(opts: LlmBrainOpts): Brain {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return {
    id: 'llm-analyst-04',
    kind: 'llm',
    charter: 'LLM analyst: reasons over the verified fact and policy in natural language.',
    async evaluate({ fact, policy, round, summary, ownRound1 }) {
      const lines = [
        'You are an autonomous payment analyst on a three-agent quorum fleet.',
        'You are given a CRYPTOGRAPHICALLY VERIFIED on-chain fact and a payment policy.',
        'Vote APPROVE only if the verified payment satisfies the policy within its stated',
        'tolerances. Vote DENY for a clear violation. Vote ABSTAIN when you genuinely',
        'cannot rule. Judge only from the given data — the fact is already verified.',
        'Return STRICT JSON: {"vote":"APPROVE|DENY|ABSTAIN","confidence":0..1,"reasons":["..."]}',
        '',
        `FACT: ${JSON.stringify({
          txHash: fact.txHash,
          sourceChain: fact.sourceChain,
          from: fact.from,
          to: fact.to,
          valueEth: Number(fact.valueWei) / 1e18,
          receiptStatus: fact.receiptStatus,
          sourceBlock: fact.headerNumber,
          verified: fact.verified,
          verifiedVia: fact.verifiedVia,
        })}`,
        `POLICY: ${JSON.stringify({
          payee: policy.payee,
          expectedEth: Number(policy.expectedAmountWei) / 1e18,
          shortfallToleranceBps: policy.shortfallToleranceBps,
          overpayToleranceBps: policy.overpayToleranceBps,
          minEth: Number(policy.minAmountWei) / 1e18,
        })}`,
      ];
      if (round === 2 && summary) {
        const mine = ownRound1?.find((v) => v.agentId === this.id);
        lines.push(
          '',
          'ROUND 2 — DEBATE. Round 1 was a secret ballot; the tally is now published:',
          `tally: ${summary.approvals} APPROVE / ${summary.denials} DENY / ${summary.abstentions} ABSTAIN`,
          ...(mine ? [`your own round-1 ballot: ${mine.vote} (confidence ${mine.confidence.toFixed(2)})`] : []),
          'You may revise your vote exactly once, with a reason. Revision is not required.',
        );
      }
      const prompt = lines.join('\n');

      const body = JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });
      const post = () => doFetch(`${opts.url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      let res: Response;
      try {
        res = await post();
        if (res.status >= 500) res = await post(); // one retry on server errors
      } catch (e) {
        try {
          res = await post(); // one retry on transport errors/timeouts
        } catch (e2) {
          throw new Error(`LLM endpoint unreachable (${(e2 as Error).message}; first error: ${(e as Error).message})`);
        }
      }
      if (!res.ok) throw new Error(`LLM endpoint ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? '';
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('LLM returned no JSON object');
      const parsed = JSON.parse(match[0]) as {
        vote?: string; confidence?: number; reasons?: string[];
      };
      const vote = (['APPROVE', 'DENY', 'ABSTAIN'] as VoteKind[]).includes(parsed.vote as VoteKind)
        ? (parsed.vote as VoteKind)
        : 'ABSTAIN';
      return {
        agentId: this.id,
        agentKind: this.kind,
        vote,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
        reasons: (parsed.reasons ?? []).slice(0, 5).map(String),
      };
    },
  };
}

/** Zero-cost local inference lane (OpenAI-compatible llama.cpp/ollama-class
 *  server on localhost). Used by --llm when no endpoint is configured via env. */
export const LOCAL_LLM_URL = 'http://127.0.0.1:11434/v1';
export const LOCAL_LLM_KEY = 'local-inference'; // llama.cpp needs a non-empty bearer

/** Ask a local OpenAI-compatible server which model it serves (first listed).
 *  Retries once: the local lane rides an auto-reconnecting ssh forward that
 *  flaps briefly during restarts — one retry absorbs it. */
export async function pickLocalModel(url = LOCAL_LLM_URL, fetchImpl: typeof fetch = fetch): Promise<string> {
  const ask = async (): Promise<string> => {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`local model discovery HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { id?: string }[] };
    const id = json.data?.[0]?.id;
    if (!id) throw new Error('local model discovery returned no models');
    return id;
  };
  try {
    return await ask();
  } catch {
    await new Promise((r) => setTimeout(r, 1_000));
    return ask();
  }
}
