/** Eval trail runner — `npm run eval` (gate) / `npm run eval:llm` (record).
 *
 * Writes one append-only JSONL line per scenario to evals/trail/ and prints
 * the summary table. Exit contract:
 *   - deterministic run: exit 0 iff 100% (a miss is a defect — never green prose)
 *   - LLM-augmented run: exit 0 unless the DETERMINISTIC core regresses; LLM
 *     disagreements are recorded as findings (heterogeneous signal), printed
 *     in full, and never silently dropped.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Fleet } from '../src/core/fleet.js';
import { resolveLlmBrain } from '../src/core/llmlane.js';
import { loadSuite, runSuite } from '../src/evals.js';

async function main(): Promise<number> {
  const withLlm = process.argv.includes('--llm');
  const suite = await loadSuite();
  const trailDir = 'evals/trail';
  await mkdir(trailDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trailPath = join(trailDir, `run-${stamp}${withLlm ? '-llm' : ''}.jsonl`);

  let fleet = new Fleet({ chainLabel: 'eval' });
  let llmVia: string | undefined;
  if (withLlm) {
    const lane = await resolveLlmBrain();
    llmVia = lane.via;
    fleet = new Fleet({ chainLabel: 'eval', extraBrains: [lane.brain] });
  }

  const report = await runSuite(fleet, suite, llmVia);

  for (const r of report.results) {
    await appendFile(trailPath, JSON.stringify({ v: 1, suite: report.suite, fleetKind: report.fleetKind, llmVia: report.llmVia ?? null, ranAt: report.ranAt, ...r }) + '\n');
  }

  console.log(`Ledgerhand eval suite — ${report.suite} (${report.fleetKind}${report.llmVia ? `, ${report.llmVia}` : ''})`);
  console.log(`trail: ${trailPath}`);
  console.log('');
  for (const r of report.results) {
    const mark = r.pass ? 'PASS' : 'MISS';
    console.log(`  [${mark}] ${r.scenarioId.padEnd(34)} expected=${r.expectedDecision.padEnd(7)} got=${r.actualDecision.padEnd(7)} approvals=${r.quorum.approvals}/${r.quorum.fleetSize}  ${r.certHash.slice(0, 14)}…`);
    if (!r.pass) {
      for (const v of r.votes.filter((x) => x.round === 2)) {
        console.log(`         · ${v.agentId} ${v.vote} (${v.confidence.toFixed(2)}) — ${v.reasons[0] ?? ''}`);
      }
    }
  }
  console.log('');
  console.log(`accuracy: ${report.passed}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`);
  console.log('per-agent agreement with ground truth (final votes):');
  for (const [agent, a] of Object.entries(report.perAgentAgreement)) {
    console.log(`  ${agent.padEnd(14)} ${a.aligned}/${a.total}`);
  }

  if (!withLlm && report.passed !== report.total) {
    console.error(`\nGATE FAILED: deterministic fleet must be 100% on ${report.suite}`);
    return 1;
  }
  if (withLlm && report.passed !== report.total) {
    console.log(`\nNOTE: LLM-augmented misses recorded as findings (deterministic core unaffected by construction).`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
