/** QuorumRegistryAnchor — the on-chain enforcement rail.
 *
 * BUILD-TO-THE-LINE state (2026-09-19, P1): everything here is implemented
 * and unit-tested OFFLINE (argument encoding, signature-recovery simulation,
 * artifact), but executing deploy()/anchor() requires a funded testnet
 * account — LEDGERHAND_ANCHOR_KEY. Wallets/keys are CEO-only acts (desk
 * §CEO-GATED item LH-G1): this module never creates, imports, or exercises
 * an account on its own; it refuses with a GATED error until the env var is
 * provided by the CEO-authorized run. Read-side (verifyOnChain) needs no
 * key at all.
 *
 * Submit encoding targets the ROUND-2 ballots only — the contract's digest
 * pins round=2 (contracts/QuorumRegistry.sol, submitDecision), i.e. the
 * certificate's final fleet state.
 */
import { Contract, ContractFactory, JsonRpcProvider, Wallet, verifyMessage } from 'ethers';
import { readFileSync } from 'node:fs';
import type { DeliberationTrace } from '../core/types.js';
import { agentIdHash, splitSignature, VOTE_BYTE, voteDigest } from '../core/certificate.js';
import type { ReceiptAnchor } from './types.js';
import type { AnchorConfig } from './anchors.js';

export const ANCHOR_KEY_ENV = 'LEDGERHAND_ANCHOR_KEY';

export function anchorKeyError(): Error {
  return new Error(
    `CEO-GATED (desk item LH-G1): on-chain anchoring needs a funded testnet account key in $${ANCHOR_KEY_ENV}. ` +
      `Keys/wallets are the CEO's hands only. Everything up to this line is built and tested; ` +
      `the local receipt book (LocalReceiptAnchor) carries the product slice meanwhile.`,
  );
}

export function anchorKeyFromEnv(): string | undefined {
  const k = process.env[ANCHOR_KEY_ENV];
  return k && k.trim() !== '' ? k.trim() : undefined;
}

/** Minimal ABI for QuorumRegistry (contracts/QuorumRegistry.sol). */
export const QUORUM_REGISTRY_ABI = [
  'constructor()',
  'function owner() view returns (address)',
  'function agentControl(bytes32 agentId) view returns (address)',
  'function decisions(bytes32 factHash) view returns (tuple(bytes32 certHash, uint8 decision, uint8 approvals, uint8 fleetSize, uint64 timestamp))',  'function registerAgent(bytes32 agentId, address control)',
  'function submitDecision(bytes32 factHash, bytes32 policyId, uint8 decision, bytes32[] agentIds, address[] signers, bytes32[] r, bytes32[] s, uint8[] v, uint8[] votes, uint8 requiredApprovals) returns (bytes32 certHash)',
  'event DecisionRecorded(bytes32 indexed certHash, bytes32 indexed factHash, bytes32 policyId, uint8 decision, uint8 approvals, uint8 fleetSize)',
] as const;

export interface RegistryArtifact {
  contractName: string;
  compilerVersion: string;
  sourceSha256: string;
  compiledAt: string;
  abi: unknown[];
  bytecode: string;
}

export const REGISTRY_ARTIFACT_PATH = 'artifacts/QuorumRegistry.json';

/** Load the checked-in compile artifact (produced by scripts/compile-contract.ts;
 *  run `npm run compile:contract` after touching the .sol). cwd-relative. */
export function loadRegistryArtifact(path: string = REGISTRY_ARTIFACT_PATH): RegistryArtifact {
  let raw: RegistryArtifact;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as RegistryArtifact;
  } catch (e) {
    throw new Error(`registry artifact unreadable (${path}): run npm run compile:contract — ${(e as Error).message}`);
  }
  if (!raw.bytecode?.startsWith('0x') || !Array.isArray(raw.abi)) {
    throw new Error(`registry artifact malformed: ${path}`);
  }
  return raw;
}

/** The pure argument bundle submitDecision expects, derived from a trace. */
export interface SubmitArgs {
  factHash: string;
  policyId: string;
  decision: 0 | 1;
  agentIds: string[];
  signers: string[];
  r: string[];
  s: string[];
  v: number[];
  votes: number[];
  requiredApprovals: number;
}

export function buildSubmitArgs(trace: DeliberationTrace): SubmitArgs {
  const cert = trace.certificate;
  const finalVotes = cert.votes.filter((v) => v.round === 2);
  if (finalVotes.length === 0) throw new Error('no round-2 ballots in certificate');
  const rs: string[] = [];
  const ss: string[] = [];
  const vs: number[] = [];
  for (const vote of finalVotes) {
    if (!vote.signature) throw new Error(`${vote.agentId}: round-2 ballot missing signature`);
    const sig = splitSignature(vote.signature);
    rs.push(sig.r);
    ss.push(sig.s);
    vs.push(sig.v);
  }
  return {
    factHash: cert.factHash,
    policyId: cert.policyId,
    decision: cert.decision === 'EXECUTE' ? 1 : 0,
    agentIds: finalVotes.map((v) => agentIdHash(v.agentId)),
    signers: finalVotes.map((v) => v.agentAddress),
    r: rs,
    s: ss,
    v: vs,
    votes: finalVotes.map((v) => VOTE_BYTE[v.vote]),
    requiredApprovals: cert.quorum.required,
  };
}

/** Offline rehearsal of exactly what the contract's ecrecover loop checks:
 *  every round-2 ballot signature must recover to its declared signer over
 *  the round-2 digest. If this passes, submitDecision will not revert on
 *  BadSigner (given the byte-matched digest layout). */
export function rehearsalRecovery(trace: DeliberationTrace): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const cert = trace.certificate;
  for (const vote of cert.votes.filter((v) => v.round === 2)) {
    const digest = voteDigest({
      factHash: cert.factHash,
      policyId: cert.policyId,
      round: 2,
      agentId: vote.agentId,
      vote: vote.vote,
    });
    const recovered = verifyMessage(digest, vote.signature!).toLowerCase();
    if (recovered !== vote.agentAddress.toLowerCase()) {
      failures.push(`${vote.agentId}: recovered ${recovered} != declared ${vote.agentAddress}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

export class QuorumRegistryAnchor implements ReceiptAnchor {
  readonly label: string;
  private registry: Contract | undefined;

  private constructor(
    private readonly signer: Wallet,
    private readonly anchorCfg: AnchorConfig,
    private readonly artifact: RegistryArtifact,
  ) {
    this.label = `${anchorCfg.label}:QuorumRegistry`;
  }

  /** Open with the CEO-provided key. Throws the GATED error when absent. */
  static open(anchor: AnchorConfig, artifact: RegistryArtifact): QuorumRegistryAnchor {
    const key = anchorKeyFromEnv();
    if (!key) throw anchorKeyError();
    const provider = new JsonRpcProvider(anchor.rpcUrl, anchor.chainId, { staticNetwork: true });
    const signer = new Wallet(key, provider);
    return new QuorumRegistryAnchor(signer, anchor, artifact);
  }

  /** Deploy QuorumRegistry (the funded, CEO-gated act). */
  async deploy(): Promise<{ registry: string; txHash: string; deployer: string }> {
    const factory = new ContractFactory(QUORUM_REGISTRY_ABI as unknown as string[], this.artifact.bytecode, this.signer);
    const contract = (await factory.deploy()) as unknown as Contract;
    await contract.deploymentTransaction()!.wait();
    this.registry = contract;
    return { registry: await contract.getAddress(), txHash: contract.deploymentTransaction()!.hash, deployer: this.signer.address };
  }

  attach(registryAddress: string): this {
    this.registry = new Contract(registryAddress, QUORUM_REGISTRY_ABI as unknown as string[], this.signer);
    return this;
  }

  async registryAddress(): Promise<string> {
    if (!this.registry) throw new Error('no registry attached/deployed — call deploy() or attach() first');
    return this.registry.getAddress();
  }

  async anchor(trace: DeliberationTrace): Promise<{ txHash: string; registry: string }> {
    const reg = this.registry;
    if (!reg) throw new Error('no registry attached/deployed — call deploy() or attach() first');
    const a = buildSubmitArgs(trace);
    const submitter = reg as unknown as {
      submitDecision: (
        factHash: string, policyId: string, decision: number, agentIds: string[], signers: string[],
        r: string[], s: string[], v: number[], votes: number[], requiredApprovals: number,
      ) => Promise<{ wait: () => Promise<{ status: number } | null>; hash: string }>;
    };
    const tx = await submitter.submitDecision(
      a.factHash, a.policyId, a.decision, a.agentIds, a.signers, a.r, a.s, a.v, a.votes, a.requiredApprovals,
    );
    const rcpt = await tx.wait();
    if (rcpt === null || rcpt.status !== 1) throw new Error(`submitDecision tx failed: ${tx.hash}`);
    trace.certificate.registry = await reg.getAddress();
    return { txHash: tx.hash, registry: await reg.getAddress() };
  }

  /** Read-only verification of a recorded decision (no key needed). */
  static async verifyOnChain(
    anchor: AnchorConfig,
    registryAddress: string,
    trace: DeliberationTrace,
  ): Promise<{ recorded: boolean; matches: boolean; onChain: { certHash: string; decision: number; approvals: number; fleetSize: number; timestamp: number } | null }> {
    const provider = new JsonRpcProvider(anchor.rpcUrl, anchor.chainId, { staticNetwork: true });
    const registry = new Contract(registryAddress, QUORUM_REGISTRY_ABI as unknown as string[], provider) as unknown as {
      decisions: (factHash: string) => Promise<{ certHash: string; decision: number; approvals: number; fleetSize: number; timestamp: bigint }>;
    };
    const d = await registry.decisions(trace.certificate.factHash);
    if (d.timestamp === 0n) return { recorded: false, matches: false, onChain: null };
    const onChain = { certHash: d.certHash, decision: d.decision, approvals: d.approvals, fleetSize: d.fleetSize, timestamp: Number(d.timestamp) };
    const cert = trace.certificate;
    const matches =
      onChain.certHash.toLowerCase() === cert.certHash.toLowerCase() &&
      onChain.decision === (cert.decision === 'EXECUTE' ? 1 : 0) &&
      onChain.approvals === cert.quorum.approvals &&
      onChain.fleetSize === cert.quorum.fleetSize;
    return { recorded: true, matches, onChain };
  }
}
