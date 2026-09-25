/** Ledgerhand Chamber UI — the P2 operator slice in a browser.
 *
 * "Hand work to the ledger, get a signed quorum receipt": convene the fleet
 * over a real chain fact, watch both rounds deliberate, read the sealed
 * certificate, browse the docket of recorded receipts.
 *
 * Serving contract (parent QuorumProof's gate, as-found):
 *   - node:http only, zero new dependencies
 *   - binds 127.0.0.1 ONLY (local instrument; no external exposure)
 *   - static assets from src/ui, JSON API over the shared operator pipeline
 *     (src/operator.ts) — the UI and the CLI run byte-identical logic
 *
 * Design system: parent's DESIGN-SYSTEM.md (chamber, dual theme, matte,
 * serif ceremony + mono evidence) — see docs/DESIGN-GATES-P2.md.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORS, DEFAULT_ANCHOR, probeAnchor } from '../binding/anchors.js';
import { DEFAULT_LEDGER_PATH } from '../binding/local.js';
import { runVerification } from '../operator.js';

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LEDGERHAND_UI_PORT ?? 8791);
const HOST = '127.0.0.1'; // local-only by construction

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jsonl': 'application/jsonl; charset=utf-8',
};

async function serveStatic(res: ServerResponse, rel: string): Promise<void> {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/g, '');
  let body: Buffer;
  try {
    body = await readFile(join(UI_DIR, safe));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = safe.slice(safe.lastIndexOf('.'));
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Tail of the local receipt book (newest last → newest first). */
async function readReceipts(limit: number): Promise<unknown[]> {
  try {
    const text = await readFile(DEFAULT_LEDGER_PATH, 'utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch {
    return []; // no book yet — honest empty docket
  }
}

/** Anchor health with a 20s shared cache so the page never hammers RPCs. */
let anchorCache: { at: number; data: unknown } | null = null;
async function anchorsPayload(): Promise<unknown> {
  if (anchorCache && Date.now() - anchorCache.at < 20_000) return anchorCache.data;
  const probes = await Promise.all(Object.values(ANCHORS).map((a) => probeAnchor(a)));
  const data = {
    default: DEFAULT_ANCHOR,
    anchors: probes.map((p) => ({
      label: p.label,
      ok: p.ok,
      chainId: p.chainId,
      blockNumber: p.blockNumber,
      error: p.error ?? null,
      explorerTx: ANCHORS[p.label]?.explorerTx ?? null,
    })),
  };
  anchorCache = { at: Date.now(), data };
  return data;
}

export function createUiServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') return void (await serveStatic(res, 'index.html'));
      if (req.method === 'GET' && url.pathname === '/ui.css') return void (await serveStatic(res, 'ui.css'));
      if (req.method === 'GET' && url.pathname === '/ui.js') return void (await serveStatic(res, 'ui.js'));
      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        return void (await serveStatic(res, url.pathname.slice(1)));
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return void sendJson(res, 200, { ok: true, service: 'ledgerhand-chamber', anchor: DEFAULT_ANCHOR, ledger: DEFAULT_LEDGER_PATH });
      }
      if (req.method === 'GET' && url.pathname === '/api/anchors') {
        return void sendJson(res, 200, await anchorsPayload());
      }
      if (req.method === 'GET' && url.pathname === '/api/receipts') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        return void sendJson(res, 200, { receipts: await readReceipts(limit) });
      }
      if (req.method === 'POST' && url.pathname === '/api/verify') {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
        } catch {
          return void sendJson(res, 400, { error: 'invalid JSON body' });
        }
        const result = await runVerification({
          txHash: String(parsed.txHash ?? ''),
          payee: String(parsed.payee ?? ''),
          expectedEth: String(parsed.expectedEth ?? ''),
          shortfallToleranceBps: parsed.shortBps == null ? undefined : Number(parsed.shortBps),
          overpayToleranceBps: parsed.overBps == null ? undefined : Number(parsed.overBps),
          minEth: parsed.minEth == null ? undefined : String(parsed.minEth),
          anchor: parsed.anchor == null ? undefined : String(parsed.anchor),
          llm: parsed.llm === true,
        });
        return void sendJson(res, 200, {
          fact: {
            txHash: result.fact.txHash,
            sourceChain: result.fact.sourceChain,
            chainKey: result.fact.chainKey,
            block: result.fact.headerNumber,
            head: result.fact.attestedHeight ?? null,
            from: result.fact.from,
            to: result.fact.to,
            valueEth: Number(result.fact.valueWei) / 1e18,
            receiptStatus: result.fact.receiptStatus,
            verifiedVia: result.fact.verifiedVia,
            factHash: result.fact.factHash,
          },
          policyId: result.policyId,
          rounds: result.trace.rounds,
          summary: {
            decision: result.trace.certificate.decision,
            quorum: result.trace.certificate.quorum,
            certHash: result.trace.certificate.certHash,
            ballotBoxHash: result.trace.ballotBoxHash,
          },
          audit: { signatures: result.audit.ok, rehearsal: result.rehearsal.ok },
          receipt: result.receipt,
          llmVia: result.llmVia ?? null,
          anchorLabel: result.anchorLabel,
        });
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      sendJson(res, 422, { error: (e as Error).message });
    }
  });
}

export async function startUiServer(port = PORT): Promise<{ server: ReturnType<typeof createUiServer>; url: string }> {
  const server = createUiServer();
  await new Promise<void>((resolve) => server.listen(port, HOST, resolve));
  const bound = server.address();
  if (bound == null || typeof bound === 'string') throw new Error('unexpected listen address');
  return { server, url: `http://${HOST}:${bound.port}` };
}

// Entry (skipped under vitest via import.meta.vitest guard absence — plain main):
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startUiServer()
    .then(({ url }) => {
      console.log(`Ledgerhand chamber — ${url} (local-only bind; Ctrl-C to stop)`);
      console.log(`  anchor of record: ${DEFAULT_ANCHOR} · receipt book: ${DEFAULT_LEDGER_PATH}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
