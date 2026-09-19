/** Minimal JSON-RPC client over fetch — read-only by construction.
 *
 * No keys, no accounts, no signing: this client can only ask a public RPC
 * node for chain state. It exists (instead of ethers' JsonRpcProvider) so
 * the FactAttestor seam is trivially mockable in tests and adds no network
 * auto-detection beyond the calls we make explicitly. */
export interface RpcLike {
  send(method: string, params: unknown[]): Promise<unknown>;
}

export class JsonRpcClient implements RpcLike {
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async send(method: string, params: unknown[] = []): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Error(`RPC ${method} unreachable (${(e as Error).message})`);
    }
    if (!res.ok) {
      throw new Error(`RPC ${method} HTTP ${res.status} from ${this.url}`);
    }
    const text = await res.text();
    if (text.trim() === '') {
      throw new Error(`RPC ${method}: empty response body from ${this.url}`);
    }
    let json: { result?: unknown; error?: { message?: string } };
    try {
      json = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
    } catch {
      throw new Error(`RPC ${method}: non-JSON response from ${this.url}`);
    }
    if (json.error) {
      throw new Error(`RPC ${method}: ${json.error.message ?? 'unknown error'}`);
    }
    return json.result;
  }
}

/** '0x…' hex quantity → number. */
export function hexToNum(hex: string | null | undefined): number {
  if (hex == null) throw new Error(`hexToNum: null value`);
  return Number.parseInt(hex, 16);
}
