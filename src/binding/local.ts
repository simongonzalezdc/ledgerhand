/** LocalReceiptAnchor — the receipt book for the keyless product slice.
 *
 * "Hand work to the ledger, get a signed quorum receipt" must work END TO
 * END before any CEO-gated wallet exists (desk §CEO-GATED: keys are the
 * CEO's hands only). This anchor appends the audited certificate to a
 * repo-local append-only JSONL ledger — the same receipt the on-chain
 * QuorumRegistry will record, minus the enforcement rail. When the GATED
 * key ask (desk item LH-G1) is answered, the on-chain anchor takes over and
 * this stays as the offline/local-mode receipt of record.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DeliberationTrace } from '../core/types.js';
import type { ReceiptAnchor } from './types.js';

export const DEFAULT_LEDGER_PATH = 'receipts/ledger.jsonl';

export class LocalReceiptAnchor implements ReceiptAnchor {
  readonly label = 'local-receipt-book';

  constructor(private readonly ledgerPath: string = DEFAULT_LEDGER_PATH) {}

  async anchor(trace: DeliberationTrace): Promise<{ txHash: string; registry: string }> {
    const cert = trace.certificate;
    const line = JSON.stringify({
      v: 1,
      recordedAt: new Date().toISOString(),
      certHash: cert.certHash,
      factHash: cert.factHash,
      policyId: cert.policyId,
      decision: cert.decision,
      txLabel: cert.txLabel,
      chain: cert.chain,
      quorum: cert.quorum,
      ballots: cert.votes
        .filter((v) => v.round === 2)
        .map((v) => ({ agentId: v.agentId, vote: v.vote, confidence: v.confidence, signer: v.agentAddress })),
      fact: {
        sourceChain: trace.fact.sourceChain,
        headerNumber: trace.fact.headerNumber,
        from: trace.fact.from,
        to: trace.fact.to,
        valueWei: trace.fact.valueWei.toString(),
        verifiedVia: trace.fact.verifiedVia,
      },
    });
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, line + '\n');
    return { txHash: `local:${cert.certHash}`, registry: this.ledgerPath };
  }
}
