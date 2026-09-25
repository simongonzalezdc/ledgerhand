/** Ledgerhand smoke demo — the extracted core, running offline and deterministic.
 *  EXECUTE path + REJECT path + local signature audit, printed to stdout.
 *  `--llm` adds the real LLM analyst (local inference lane or env endpoint);
 *  if the endpoint is down the demo says so and stays deterministic — an
 *  honest fallback, never a silent one. */
import { Fleet, auditCertificateSignatures } from './core/fleet.js';
import { demoFact, demoPolicy } from './demo.js';

async function resolveDemoFleet(): Promise<{ fleet: Fleet; note: string }> {
  if (!process.argv.includes('--llm')) return { fleet: new Fleet({ chainLabel: 'local' }), note: '' };
  try {
    const { resolveLlmBrain } = await import('./core/llmlane.js');
    const { brain, via } = await resolveLlmBrain();
    return {
      fleet: new Fleet({ chainLabel: 'local', extraBrains: [brain] }),
      note: `LLM analyst included (${via}) — 4 brains, quorum still 2-of-N`,
    };
  } catch (e) {
    return {
      fleet: new Fleet({ chainLabel: 'local' }),
      note: `LLM analyst UNAVAILABLE (${(e as Error).message}) — running the deterministic fleet`,
    };
  }
}

async function main() {
  const { fleet, note } = await resolveDemoFleet();
  const withLlm = note.includes('LLM analyst included');
  console.log(`Ledgerhand — quorum core smoke (deterministic core${withLlm ? ' + real LLM analyst' : ', offline'})`);
  if (note) console.log(note);
  console.log('fleet roster:');
  for (const a of fleet.roster) {
    console.log(`  ${a.agentId} (${a.kind}) ${a.agentAddress} — ${a.charter}`);
  }

  console.log('\n[1] policy-matching payment → expect EXECUTE');
  const ok = await fleet.deliberate(demoFact(), demoPolicy());
  console.log(`    decision=${ok.certificate.decision} approvals=${ok.certificate.quorum.approvals}/${ok.certificate.quorum.fleetSize}`);
  console.log(`    certHash=${ok.certificate.certHash}`);
  console.log(`    audit=${auditCertificateSignatures(ok).ok ? 'ALL SIGNATURES RECOVER' : 'FAIL'}`);

  console.log('\n[2] unrelated inflow → expect REJECT');
  const bad = await fleet.deliberate(
    demoFact({ to: '0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0', valueWei: 56_869_366_459_299_350n }),
    demoPolicy(),
  );
  console.log(`    decision=${bad.certificate.decision} approvals=${bad.certificate.quorum.approvals}/${bad.certificate.quorum.fleetSize}`);
  console.log(`    certHash=${bad.certificate.certHash}`);
  console.log(`    audit=${auditCertificateSignatures(bad).ok ? 'ALL SIGNATURES RECOVER' : 'FAIL'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
