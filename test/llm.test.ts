/**
 * LLM analyst suite (P2) — the real-LLM operator lane, tested against an
 * injected OpenAI-compatible endpoint. No network, no keys, no spend.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_LLM_URL, makeLlmBrain, pickLocalModel } from '../src/core/brains.js';
import type { BrainContext } from '../src/core/brains.js';
import { demoFact, demoPolicy } from '../src/demo.js';

/** Minimal fake `fetch` serving /chat/completions + /models. */
function fakeEndpoint(opts: {
  content?: string;
  status?: number;
  failTimes?: number;
  captured?: { url: string; body: string }[];
}): typeof fetch {
  let failuresLeft = opts.failTimes ?? 0;
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (opts.captured && init?.body) opts.captured.push({ url, body: String(init.body) });
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error('simulated transport failure');
    }
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'fake-model-7b' }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: opts.content ?? '{"vote":"APPROVE","confidence":0.9,"reasons":["ok"]}' } }] }),
      { status: opts.status ?? 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

function ctx(overrides: Partial<BrainContext> = {}): BrainContext {
  return { fact: demoFact(), policy: demoPolicy(), round: 1, ...overrides };
}

const ROUND2_CTX: BrainContext = ctx({
  round: 2,
  summary: { approvals: 2, denials: 1, abstentions: 0, ballotBoxHash: '0x' + 'ab'.repeat(32) },
  ownRound1: [{
    agentId: 'llm-analyst-04', agentKind: 'llm', agentAddress: '0x' + '0'.repeat(40),
    vote: 'DENY', confidence: 0.7, reasons: ['r'], round: 1,
  }],
});

describe('llm analyst', () => {
  it('parses a strict JSON vote into the ballot contract', async () => {
    const brain = makeLlmBrain({ url: 'http://fake/v1', model: 'm', apiKey: 'k', fetchImpl: fakeEndpoint({}) });
    const vote = await brain.evaluate(ctx());
    expect(vote.agentId).toBe('llm-analyst-04');
    expect(vote.agentKind).toBe('llm');
    expect(vote.vote).toBe('APPROVE');
    expect(vote.confidence).toBe(0.9);
    expect(vote.reasons).toEqual(['ok']);
  });

  it('coerces an unknown vote to ABSTAIN and clamps confidence', async () => {
    const brain = makeLlmBrain({
      url: 'http://fake/v1', model: 'm', apiKey: 'k',
      fetchImpl: fakeEndpoint({ content: '{"vote":"MAYBE","confidence":7,"reasons":[]}' }),
    });
    const vote = await brain.evaluate(ctx());
    expect(vote.vote).toBe('ABSTAIN');
    expect(vote.confidence).toBe(1);
  });

  it('round-2 prompt carries the published tally and its own round-1 ballot', async () => {
    const captured: { url: string; body: string }[] = [];
    const brain = makeLlmBrain({
      url: 'http://fake/v1', model: 'm', apiKey: 'k',
      fetchImpl: fakeEndpoint({ captured }),
    });
    await brain.evaluate(ROUND2_CTX);
    expect(captured.length).toBe(1); // exactly one call — no spurious retries
    const prompt = (JSON.parse(captured[0]!.body) as { messages: { content: string }[] }).messages[0]!.content;
    expect(prompt).toContain('ROUND 2 — DEBATE');
    expect(prompt).toContain('2 APPROVE / 1 DENY / 0 ABSTAIN');
    expect(prompt).toContain('your own round-1 ballot: DENY');
  });

  it('round-1 prompt does not leak the tally', async () => {
    const captured: { url: string; body: string }[] = [];
    const brain = makeLlmBrain({ url: 'http://fake/v1', model: 'm', apiKey: 'k', fetchImpl: fakeEndpoint({ captured }) });
    await brain.evaluate(ctx());
    const prompt = (JSON.parse(captured[0]!.body) as { messages: { content: string }[] }).messages[0]!.content;
    expect(prompt).not.toContain('ROUND 2 — DEBATE');
  });

  it('throws honestly when the model returns no JSON object', async () => {
    const brain = makeLlmBrain({
      url: 'http://fake/v1', model: 'm', apiKey: 'k',
      fetchImpl: fakeEndpoint({ content: 'I cannot answer that' }),
    });
    await expect(brain.evaluate(ctx())).rejects.toThrow('LLM returned no JSON object');
  });

  it('retries once on transport failure, then fails honestly', async () => {
    const brain = makeLlmBrain({
      url: 'http://fake/v1', model: 'm', apiKey: 'k',
      fetchImpl: fakeEndpoint({ failTimes: 1 }),
    });
    const vote = await brain.evaluate(ctx()); // first call fails, retry succeeds
    expect(vote.vote).toBe('APPROVE');

    const dead = makeLlmBrain({
      url: 'http://fake/v1', model: 'm', apiKey: 'k',
      fetchImpl: fakeEndpoint({ failTimes: 2 }),
    });
    await expect(dead.evaluate(ctx())).rejects.toThrow('LLM endpoint unreachable');
  });

  it('composes additively: default fleet + LLM brain = 4 ballots, quorum unchanged', async () => {
    const { Fleet } = await import('../src/core/fleet.js');
    const brain = makeLlmBrain({ url: 'http://fake/v1', model: 'm', apiKey: 'k', fetchImpl: fakeEndpoint({}) });
    const fleet = new Fleet({ chainLabel: 'local', extraBrains: [brain] });
    expect(fleet.roster.map((r) => r.agentId)).toEqual(['ledger-01', 'sentinel-02', 'meridian-03', 'llm-analyst-04']);
    expect(fleet.quorum.requiredApprovals).toBe(2);
    const trace = await fleet.deliberate(demoFact(), demoPolicy());
    expect(trace.certificate.quorum.fleetSize).toBe(4);
    expect(trace.certificate.votes.filter((v) => v.agentId === 'llm-analyst-04')).toHaveLength(2); // both rounds
  });

  it('pickLocalModel discovers the served model from /models', async () => {
    const model = await pickLocalModel(LOCAL_LLM_URL, fakeEndpoint({}));
    expect(model).toBe('fake-model-7b');
  });
});
