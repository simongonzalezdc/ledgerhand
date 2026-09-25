/** Ledgerhand operator path — the product slice (P1).
 *
 *   "Hand work to the ledger, get a signed quorum receipt."
 *
 *   ledger probe [anchor|all]      anchor RPC health (chainId + block) — also
 *                                  the daily HyperEVM re-probe watch
 *   ledger verify <txHash>         verify the tx on the anchor chain (read-only),
 *        --payee 0x…               deliberate over it against the policy,
 *        --expected-eth 3.6        audit every ballot signature, and record
 *        [--anchor arb-sepolia]    the receipt (local receipt book by default;
 *        [--short-bps 100]         --onchain uses QuorumRegistry — CEO-gated
 *        [--over-bps 500]          key required, desk item LH-G1)
 *        [--min-eth 0.05]
 *        [--onchain] [--registry 0x…]
 *
 * Deterministic brains (no LLM calls until P2), zero keys on every path that
 * does not opt into --onchain, zero spend: reads are public RPC calls.
 */
import { resolveAnchor, ANCHORS, DEFAULT_ANCHOR, probeAnchor } from './binding/anchors.js';
import { runVerification, type VerifyResult } from './operator.js';
import { ANCHOR_KEY_ENV, QuorumRegistryAnchor, anchorKeyFromEnv, anchorKeyError, loadRegistryArtifact } from './binding/registry.js';

function usage(): string {
  return [
    'usage:',
    '  ledger probe [anchor|all]                         anchor RPC health',
    '  ledger verify <txHash> --payee 0x.. --expected-eth <n> [options]',
    'options:',
    `  --anchor <name>    chain to verify on (default: ${DEFAULT_ANCHOR} — P0 ruling 2026-09-19; known: ${Object.keys(ANCHORS).join(', ')})`,
    '  --short-bps <n>    shortfall tolerance, bps (default 100 = 1%)',
    '  --over-bps <n>     overpay tolerance, bps (default 500 = 5%)',
    '  --min-eth <n>      dust floor in ETH (default 0.05)',
    '  --llm              add the LLM analyst as a 4th brain (env endpoint, or the',
    '                     zero-cost local inference lane on 127.0.0.1:11434)',
    '  --onchain          also anchor the receipt on QuorumRegistry (CEO-gated key)',
    '  --registry 0x..    existing QuorumRegistry address (else deploy)',
    '  --ledger <path>    local receipt book path (default receipts/ledger.jsonl)',
  ].join('\n');
}

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Map<string, string | true> } {
  const [cmd = '', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

const flagStr = (flags: Map<string, string | true>, key: string): string | undefined => {
  const v = flags.get(key);
  return typeof v === 'string' ? v : undefined;
};

async function cmdProbe(target: string): Promise<number> {
  const names = target === 'all' || target === '' ? Object.keys(ANCHORS) : [target];
  let anyOk = false;
  for (const name of names) {
    const anchor = resolveAnchor(name);
    const p = await probeAnchor(anchor);
    anyOk = anyOk || p.ok;
    const state = p.ok ? `LIVE  chainId=${p.chainId} (0x${p.chainId!.toString(16)}) block=${p.blockNumber}` : `DEAD  ${p.error}`;
    console.log(`${anchor.label.padEnd(17)} ${state}`);
    if (anchor.note) console.log(`${''.padEnd(17)} note: ${anchor.note}`);
  }
  return anyOk ? 0 : 1;
}

async function cmdVerify(txHash: string, flags: Map<string, string | true>): Promise<number> {
  const payee = flagStr(flags, 'payee');
  const expectedEth = flagStr(flags, 'expected-eth');
  if (!payee || !/^0x[0-9a-fA-F]{40}$/.test(payee)) {
    console.error('--payee <0x address> is required');
    return 1;
  }
  if (!expectedEth || Number.isNaN(Number(expectedEth))) {
    console.error('--expected-eth <number> is required');
    return 1;
  }

  const anchor = resolveAnchor(flagStr(flags, 'anchor'));

  // 1–4. verify → deliberate → audit → local receipt (shared operator path)
  let r: VerifyResult;
  try {
    r = await runVerification({
      txHash,
      payee,
      expectedEth,
      shortfallToleranceBps: Number(flagStr(flags, 'short-bps') ?? 100),
      overpayToleranceBps: Number(flagStr(flags, 'over-bps') ?? 500),
      minEth: flagStr(flags, 'min-eth'),
      anchor: anchor.label,
      llm: flags.has('llm'),
      ledgerPath: flagStr(flags, 'ledger'),
    });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const { fact, trace, receipt: localRef } = r;
  const cert = trace.certificate;
  console.log(`[verify] ${fact.txHash}`);
  console.log(`  source=${fact.sourceChain} (chainKey ${fact.chainKey}) block=${fact.headerNumber} head=${fact.attestedHeight}`);
  console.log(`  from=${fact.from} to=${fact.to}`);
  console.log(`  value=${Number(fact.valueWei) / 1e18} ETH  status=${fact.receiptStatus}  verifiedVia=${fact.verifiedVia}`);
  console.log(`  factHash=${fact.factHash}`);
  if (r.llmVia) console.log(`[fleet] LLM analyst included (${r.llmVia}) — 4 brains, quorum still 2-of-N`);
  console.log(`[deliberate] decision=${cert.decision} approvals=${cert.quorum.approvals}/${cert.quorum.fleetSize} (required ${cert.quorum.required})`);
  for (const v of cert.votes.filter((x) => x.round === 2)) {
    console.log(`  ${v.agentId.padEnd(13)} ${v.vote.padEnd(7)} conf=${v.confidence.toFixed(2)}  signer=${v.agentAddress}`);
  }
  console.log(`  certHash=${cert.certHash}`);
  console.log('  audit=ALL SIGNATURES RECOVER (local + round-2 on-chain rehearsal)');
  console.log(`[receipt] local   ${localRef.txHash}  (${localRef.registry})`);

  if (flags.has('onchain')) {
    if (!anchorKeyFromEnv()) {
      console.error(`\n${anchorKeyError().message}`);
      console.error(`The local receipt above stands as the receipt of record. To run the on-chain leg, the desk's GATED item LH-G1 must be answered (a funded testnet key provided via $${ANCHOR_KEY_ENV}).`);
      return 2;
    }
    const artifact = loadRegistryArtifact();
    const onchain = QuorumRegistryAnchor.open(anchor, artifact);
    const registryArg = flagStr(flags, 'registry');
    let registry: string;
    let deployTx = '';
    if (registryArg) {
      onchain.attach(registryArg);
      registry = registryArg;
    } else {
      const d = await onchain.deploy();
      registry = d.registry;
      deployTx = d.txHash;
    }
    const ref = await onchain.anchor(trace);
    const verify = await QuorumRegistryAnchor.verifyOnChain(anchor, registry, trace);
    console.log(`[receipt] onchain ${ref.txHash}  (QuorumRegistry ${registry}${deployTx ? `, deployed ${deployTx}` : ''})`);
    console.log(`[verify-onchain] recorded=${verify.recorded} matches=${verify.matches}`);
    if (!verify.matches) return 1;
  }

  console.log(`\nRECEIPT: ${cert.decision} — ${cert.quorum.approvals}/${cert.quorum.fleetSize} approvals, cert ${cert.certHash.slice(0, 18)}…`);
  return 0;
}

async function main(): Promise<number> {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'probe') return cmdProbe(positional[0] ?? 'all');
  if (cmd === 'verify') {
    const txHash = positional[0];
    if (!txHash) {
      console.error('verify needs a tx hash');
      console.error(usage());
      return 1;
    }
    return cmdVerify(txHash, flags);
  }
  console.error(usage());
  return cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
