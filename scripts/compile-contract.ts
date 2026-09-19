/** Compile contracts/QuorumRegistry.sol → artifacts/QuorumRegistry.json.
 *
 * Deterministic local compile via solc-js (free MIT devDependency — zero
 * spend, no external services). Run after touching the .sol; the artifact is
 * checked in so the GATED on-chain leg (desk item LH-G1) is turnkey: deploy
 * + submit + verify need only the CEO-provided key.
 *
 *   npm run compile:contract
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as {
  compile: (input: string) => string;
  version: () => string;
};

const SOURCE_PATH = 'contracts/QuorumRegistry.sol';
const OUT_PATH = 'artifacts/QuorumRegistry.json';

const source = readFileSync(SOURCE_PATH, 'utf8');
const input = {
  language: 'Solidity' as const,
  sources: { 'QuorumRegistry.sol': { content: source } },
  settings: {
    // viaIR: submitDecision's 10 parallel-array params exceed the legacy
    // pipeline's stack frame — the parent never compiled through this path.
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
  },
};

const raw = solc.compile(JSON.stringify(input));
const output = JSON.parse(raw) as {
  errors?: { severity: string; formattedMessage: string }[];
  contracts: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>>;
};

for (const err of output.errors ?? []) {
  if (err.severity === 'error') throw new Error(`solc: ${err.formattedMessage}`);
  console.warn(`solc warning: ${err.formattedMessage}`);
}

const contract = output.contracts['QuorumRegistry.sol']!.QuorumRegistry!;
const artifact = {
  contractName: 'QuorumRegistry',
  compilerVersion: solc.version(),
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  compiledAt: new Date().toISOString(),
  abi: contract.abi,
  bytecode: '0x' + contract.evm.bytecode.object,
  deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2) + '\n');
console.log(`wrote ${OUT_PATH} (${artifact.bytecode.length / 2 - 1} bytes runtime bytecode, solc ${artifact.compilerVersion}, source sha256 ${artifact.sourceSha256.slice(0, 16)}…)`);
