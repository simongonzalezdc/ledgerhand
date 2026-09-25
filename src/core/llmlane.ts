/** LLM lane resolution — shared by the CLI operator path and the demo.
 *  Kept OUT of src/ledgerhand.ts so importing it never runs the CLI. */
import { LOCAL_LLM_KEY, LOCAL_LLM_URL, makeLlmBrain, pickLocalModel, type Brain } from './brains.js';
import { LLM_API_KEY, LLM_MODEL, LLM_URL } from './config.js';

export interface LlmLane {
  brain: Brain;
  /** provenance line for receipts/logs */
  via: string;
}

/** Local inference on org hardware is slower than a hosted API: prompt
 *  processing on the served 27B runs ~18 tok/s, so a full operator prompt +
 *  JSON vote can take over a minute. 150s covers it with retry headroom. */
const LOCAL_LLM_TIMEOUT_MS = 150_000;

/** Resolve the optional LLM analyst.
 *  - env lane: LEDGERHAND_LLM_URL + _MODEL + _API_KEY (any OpenAI-compatible endpoint)
 *  - local lane (default when --llm given without env): the zero-cost localhost
 *    inference server; the served model is discovered from /v1/models.
 *  Errors are honest and fatal for the caller to surface: the operator asked
 *  for an LLM analyst, so a silent deterministic fallback would be a lie. */
export async function resolveLlmBrain(): Promise<LlmLane> {
  if (LLM_URL && LLM_MODEL) {
    if (!LLM_API_KEY) throw new Error('LEDGERHAND_LLM_URL/_MODEL set but LEDGERHAND_LLM_API_KEY missing');
    return { brain: makeLlmBrain({ url: LLM_URL, model: LLM_MODEL, apiKey: LLM_API_KEY }), via: `env ${LLM_MODEL}` };
  }
  const model = await pickLocalModel();
  return { brain: makeLlmBrain({ url: LOCAL_LLM_URL, model, apiKey: LOCAL_LLM_KEY, timeoutMs: LOCAL_LLM_TIMEOUT_MS }), via: `local ${model}` };
}
