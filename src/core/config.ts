/** Ledgerhand configuration (env-driven, zero defaults that cost money).
 *  All optional: without an LLM endpoint the fleet runs fully deterministic. */
export const LLM_URL = process.env.LEDGERHAND_LLM_URL;
export const LLM_MODEL = process.env.LEDGERHAND_LLM_MODEL;
export const LLM_API_KEY = process.env.LEDGERHAND_LLM_API_KEY;
