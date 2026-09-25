/** Eval discipline — the CS-verifiable trail (IF-59: Driver=PM builds the
 * trail; CS owns eval truth — this module makes the trail, it does not
 * certify it).
 *
 * A scenario fixes a fact + policy and states the correct DECISION. The suite
 * runner executes the fleet over every scenario, compares the fleet's ruling
 * to ground truth, and emits one append-only JSONL trail line per scenario
 * with every vote, reason, and certificate hash — evidence, not prose.
 *
 * Gating rule: the DETERMINISTIC fleet must be 100% on the suite (they are
 * auditable rules; a miss is a defect). LLM-augmented runs are recorded as
 * heterogeneous signal — disagreements are findings about the LLM lane, not
 * silent gate failures.
 */
import { readFile } from 'node:fs/promises';
import { Fleet } from './core/fleet.js';
import { demoFact, demoPolicy } from './demo.js';
import { computeFactHash } from './core/policy.js';
import type { DeliberationTrace, Policy, VerifiedFact } from './core/types.js';

export interface Scenario {
  id: string;
  description: string;
  fact: Record<string, unknown>;
  policy: Record<string, unknown>;
  expected: { decision: 'EXECUTE' | 'REJECT' };
}

export interface ScenarioSuite {
  suite: string;
  description: string;
  scenarios: Scenario[];
}

export interface ScenarioResult {
  scenarioId: string;
  pass: boolean;
  expectedDecision: string;
  actualDecision: string;
  quorum: DeliberationTrace['certificate']['quorum'];
  certHash: string;
  factHash: string;
  votes: { agentId: string; kind: string; round: 1 | 2; vote: string; confidence: number; reasons: string[] }[];
  deliberateMs: number;
}

export interface SuiteReport {
  suite: string;
  fleetKind: 'deterministic' | 'deterministic+llm';
  llmVia?: string;
  ranAt: string;
  total: number;
  passed: number;
  accuracy: number;
  perAgentAgreement: Record<string, { aligned: number; total: number }>;
  results: ScenarioResult[];
}

/** Build the fact for a scenario from demo fixtures + JSON overrides. */
export function scenarioFact(s: Scenario): VerifiedFact {
  const { factHash: _ignored, ...rest } = s.fact as Partial<VerifiedFact> & { factHash?: string };
  const merged = {
    ...demoFact(),
    ...rest,
    valueWei: rest.valueWei == null ? demoFact().valueWei : BigInt(rest.valueWei as string | number | bigint),
  };
  merged.factHash = computeFactHash({
    chainKey: merged.chainKey,
    headerNumber: merged.headerNumber,
    txHash: merged.txHash,
    verified: merged.verified,
  });
  return merged;
}

export function scenarioPolicy(s: Scenario): Policy {
  const overrides = s.policy as Partial<Policy>;
  const base = demoPolicy();
  const merged: Policy = { ...base, ...overrides };
  if (typeof merged.expectedAmountWei === 'string') merged.expectedAmountWei = BigInt(merged.expectedAmountWei);
  if (typeof merged.minAmountWei === 'string') merged.minAmountWei = BigInt(merged.minAmountWei);
  return merged;
}

/** Run the suite against a fleet. Pure w.r.t. the repo — writes nothing. */
export async function runSuite(fleet: Fleet, suite: ScenarioSuite, llmVia?: string): Promise<SuiteReport> {
  const results: ScenarioResult[] = [];
  for (const s of suite.scenarios) {
    const fact = scenarioFact(s);
    const policy = scenarioPolicy(s);
    const trace = await fleet.deliberate(fact, policy);
    const cert = trace.certificate;
    results.push({
      scenarioId: s.id,
      pass: cert.decision === s.expected.decision,
      expectedDecision: s.expected.decision,
      actualDecision: cert.decision,
      quorum: cert.quorum,
      certHash: cert.certHash,
      factHash: fact.factHash,
      votes: cert.votes.map((v) => ({ agentId: v.agentId, kind: v.agentKind, round: v.round, vote: v.vote, confidence: v.confidence, reasons: v.reasons })),
      deliberateMs: trace.timings.deliberateMs,
    });
  }
  const passed = results.filter((r) => r.pass).length;

  // Per-agent agreement: did the agent's FINAL vote align with ground truth?
  // (EXECUTE-aligned = APPROVE; REJECT-aligned = DENY; ABSTAIN counts as
  // neither aligned nor contra — recorded but excluded from the aligned count.)
  const perAgentAgreement: SuiteReport['perAgentAgreement'] = {};
  for (const r of results) {
    for (const v of r.votes.filter((x) => x.round === 2)) {
      const entry = (perAgentAgreement[v.agentId] ??= { aligned: 0, total: 0 });
      entry.total += 1;
      const aligned = (r.expectedDecision === 'EXECUTE' && v.vote === 'APPROVE') || (r.expectedDecision === 'REJECT' && v.vote === 'DENY');
      if (aligned) entry.aligned += 1;
    }
  }

  return {
    suite: suite.suite,
    fleetKind: llmVia ? 'deterministic+llm' : 'deterministic',
    llmVia,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed,
    accuracy: results.length === 0 ? 0 : passed / results.length,
    perAgentAgreement,
    results,
  };
}

export async function loadSuite(path = 'evals/scenarios.json'): Promise<ScenarioSuite> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as ScenarioSuite;
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) throw new Error(`eval suite '${path}' has no scenarios`);
  return raw;
}
