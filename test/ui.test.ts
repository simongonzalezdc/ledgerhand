/**
 * Chamber UI server suite (P2) — boots the real server on an ephemeral port
 * and exercises the local-only surface: statics, health, docket, and the
 * validation/refusal contract of the convene endpoint. No chain calls, no
 * keys, no spend (the verify happy-path against a live RPC is exercised by
 * the CLI in the operator lane, which shares src/operator.ts).
 *
 * Requests go through node:http directly (not global fetch): the vitest
 * worker's undici cannot bind loopback on this host.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { startUiServer } from '../src/ui/server.js';

const { server, url } = await startUiServer(0); // ephemeral port

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function req(path: string, method = 'GET', body?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const parsed = new URL(url + path);
  return new Promise((resolve, reject) => {
    const r = request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

describe('chamber statics', () => {
  it('serves the page with console-zero markup and the pre-paint theme script', async () => {
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    const html = res.text;
    expect(html).toContain('LEDGERHAND');
    expect(html).toContain("localStorage.getItem('lh-theme')"); // no-flash pre-paint
    expect(html).toContain('aria-live="polite"'); // verdict + tally announcements
    expect(html).not.toContain('console.log'); // console-zero contract on markup side
  });

  it('serves stylesheet, script, and self-hosted fonts', async () => {
    const css = await req('/ui.css');
    expect(css.status).toBe(200);
    // parent tokens, as-found (both themes exact)
    expect(css.text).toContain('--paper:#FBFAF7');
    expect(css.text).toContain('--ink:#1B2A41');
    expect(css.text).toContain('--seal:#8C6D2F');
    expect(css.text).toContain('[data-theme="dark"]');
    expect(css.text).toContain('--paper:#16181D');
    expect(css.text).toContain('--seal:#C9A45C');
    expect(css.text).toContain('prefers-reduced-motion'); // statics under reduced motion
    expect(css.text).not.toMatch(/-gradient\(/); // matte contract: no gradient functions

    expect((await req('/ui.js')).status).toBe(200);
    const font = await req('/assets/fonts/ss4-500.woff2');
    expect(font.status).toBe(200);
    expect(String(font.headers['content-type'])).toBe('font/woff2');
  });

  it('refuses path traversal outside src/ui', async () => {
    const res = await req('/assets/../package.json');
    expect(res.status).toBe(404);
  });
});

describe('chamber api', () => {
  it('GET /api/health reports the anchor of record and receipt book', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { ok: boolean; anchor: string; ledger: string };
    expect(body.ok).toBe(true);
    expect(body.anchor).toBe('arb-sepolia'); // P0 ruling, pinned
    expect(body.ledger).toContain('receipts/ledger.jsonl');
  });

  it('GET /api/receipts returns parsed newest-first receipt lines', async () => {
    const res = await req('/api/receipts?limit=5');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { receipts: { recordedAt: string; certHash: string }[] };
    for (const r of body.receipts) {
      expect(r.certHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    if (body.receipts.length >= 2) {
      expect(body.receipts[0]!.recordedAt >= body.receipts[1]!.recordedAt).toBe(true);
    }
  });

  it('GET /api/anchors probes every configured anchor (read-only)', async () => {
    const res = await req('/api/anchors');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { default: string; anchors: { label: string; ok: boolean }[] };
    expect(body.default).toBe('arb-sepolia');
    expect(body.anchors.map((a) => a.label).sort()).toEqual(['arb-sepolia', 'hyperevm-mainnet', 'hyperevm-testnet']);
  });

  it('POST /api/verify refuses a malformed proceeding with the contract wording', async () => {
    const res = await req('/api/verify', 'POST', JSON.stringify({ txHash: '0xdeadbeef', payee: '0x' + '0'.repeat(40), expectedEth: '1' }));
    expect(res.status).toBe(422);
    const body = JSON.parse(res.text) as { error: string };
    expect(body.error).toContain('PROCEEDING REFUSED');
    expect(body.error).toContain('32-byte transaction hash');
  });

  it('POST /api/verify refuses an invalid body outright', async () => {
    const res = await req('/api/verify', 'POST', '{not json');
    expect(res.status).toBe(400);
  });
});
