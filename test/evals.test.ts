/**
 * Eval-discipline suite (P2) — the ground-truth gate. The deterministic fleet
 * must rule 100% of the scenario suite; a miss here is a product defect, not
 * a test flake. Offline, deterministic, zero cost.
 */
import { describe, expect, it } from 'vitest';
import { Fleet } from '../src/core/fleet.js';
import { loadSuite, runSuite, scenarioFact, scenarioPolicy } from '../src/evals.js';
import { demoFact } from '../src/demo.js';

describe('scenario suite (ground truth)', () => {
  it('loads the suite and has 12 scenarios with decisions', async () => {
    const suite = await loadSuite();
    expect(suite.suite).toBe('ledgerhand-payment-window-v1');
    expect(suite.scenarios).toHaveLength(12);
    for (const s of suite.scenarios) {
      expect(['EXECUTE', 'REJECT']).toContain(s.expected.decision);
    }
  });

  it('scenario fixtures rebuild factHash from overrides (no inherited hash drift)', async () => {
    const suite = await loadSuite();
    const s12 = suite.scenarios.find((x) => x.id === 'S12-chain-agnostic')!;
    const fact = scenarioFact(s12);
    expect(fact.chainKey).toBe(999);
    expect(fact.factHash).not.toBe(demoFact().factHash); // re-hashed for the new chain/tx
    expect(fact.factHash).toMatch(/^0x[0-9a-f]{64}$/);
    const policy = scenarioPolicy(s12);
    expect(policy.payee).toBe(demoFact().to); // default policy payee unchanged
  });

  it('deterministic fleet rules 100% of the suite (the gate)', async () => {
    const suite = await loadSuite();
    const report = await runSuite(new Fleet({ chainLabel: 'eval' }), suite);
    expect(report.fleetKind).toBe('deterministic');
    expect(report.total).toBe(12);
    const misses = report.results.filter((r) => !r.pass).map((r) => `${r.scenarioId}: expected ${r.expectedDecision}, got ${r.actualDecision}`);
    expect(misses).toEqual([]);
    expect(report.accuracy).toBe(1);
    // every trail line carries evidence: full votes + certificate hashes
    for (const r of report.results) {
      expect(r.votes.filter((v) => v.round === 2)).toHaveLength(3);
      expect(r.certHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('per-agent agreement is computed over final votes', async () => {
    const suite = await loadSuite();
    const report = await runSuite(new Fleet({ chainLabel: 'eval' }), suite);
    for (const agent of ['ledger-01', 'sentinel-02', 'meridian-03']) {
      expect(report.perAgentAgreement[agent]).toBeDefined();
      expect(report.perAgentAgreement[agent]!.total).toBe(12);
    }
  });
});
