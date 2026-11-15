import type { Db } from '../db/types';
import { getSettings, setSetting } from '../settings';

// Model requests to an OpenAI-compatible chat completions endpoint (ELM by default),
// with structured output (a JSON schema). Design doc section 5:
// - the response is checked before use; if it fails the check, the request is retried once;
// - every request is logged with its tokens and an estimated cost in GBP;
// - each time the estimated total passes another £5, onSpendStep is called (a notification).
// No React Native imports, so it can be tested with jest and a fake fetch.

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  priceInGbp: number;
  priceOutGbp: number;
}

export type Feature = 'variant' | 'confusion' | 'section' | 'test';

export interface JsonRequest<T> {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  /** Returns the checked value, or a message saying what's wrong. */
  validate: (raw: unknown) => T | { error: string };
}

export type Runner = <T>(feature: Feature, req: JsonRequest<T>) => Promise<T>;

export class AiError extends Error {}

const SPEND_STEP_GBP = 5;
const TIMEOUT_MS = 120_000;

export function makeRunner(
  db: Db,
  cfg: AiConfig,
  opts: { fetch?: typeof fetch; now?: () => Date; onSpendStep?: (gbp: number) => void } = {},
): Runner {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());

  return async function run<T>(feature: Feature, req: JsonRequest<T>): Promise<T> {
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await doFetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            reasoning_effort: 'low',
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: req.schemaName, strict: true, schema: req.schema },
            },
          }),
          signal: controller.signal,
        });
      } catch (e) {
        throw new AiError(`Could not reach ${cfg.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearTimeout(timer);
      }

      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      } | null;
      const usage = { input: body?.usage?.prompt_tokens ?? 0, output: body?.usage?.completion_tokens ?? 0 };

      if (!res.ok) {
        const message = `HTTP ${res.status}: ${body?.error?.message ?? 'request failed'}`;
        await recordCall(db, cfg, feature, usage, message, now(), opts.onSpendStep);
        throw new AiError(message);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? '');
      } catch {
        lastError = 'response was not JSON';
        await recordCall(db, cfg, feature, usage, lastError, now(), opts.onSpendStep);
        continue;
      }
      const checked = req.validate(parsed);
      if (checked && typeof checked === 'object' && 'error' in checked) {
        lastError = String(checked.error);
        await recordCall(db, cfg, feature, usage, lastError, now(), opts.onSpendStep);
        continue;
      }
      await recordCall(db, cfg, feature, usage, null, now(), opts.onSpendStep);
      return checked as T;
    }
    throw new AiError(`The model's response failed the check twice: ${lastError}`);
  };
}

async function recordCall(
  db: Db,
  cfg: AiConfig,
  feature: Feature,
  usage: { input: number; output: number },
  error: string | null,
  at: Date,
  onSpendStep?: (gbp: number) => void,
): Promise<void> {
  const cost = (usage.input * cfg.priceInGbp + usage.output * cfg.priceOutGbp) / 1e6;
  await db.run(
    `INSERT INTO ai_calls (at, feature, model, input_tokens, output_tokens, cost_gbp, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [at.toISOString(), feature, cfg.model, usage.input, usage.output, cost, error ? 0 : 1, error],
  );
  const total = (await spendSummary(db)).totalGbp;
  const steps = Math.floor(total / SPEND_STEP_GBP);
  const alerted = (await getSettings(db)).aiSpendAlertedSteps;
  if (steps > alerted) {
    await setSetting(db, 'aiSpendAlertedSteps', steps);
    onSpendStep?.(steps * SPEND_STEP_GBP);
  }
}

export interface SpendSummary {
  totalGbp: number;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  since: string | null;
}

export async function spendSummary(db: Db): Promise<SpendSummary> {
  const r = await db.first<{
    total: number | null;
    calls: number;
    failed: number | null;
    input: number | null;
    output: number | null;
    since: string | null;
  }>(
    `SELECT SUM(cost_gbp) AS total, COUNT(*) AS calls, SUM(1 - ok) AS failed, SUM(input_tokens) AS input,
     SUM(output_tokens) AS output, MIN(at) AS since FROM ai_calls`,
  );
  return {
    totalGbp: r?.total ?? 0,
    calls: r?.calls ?? 0,
    failed: r?.failed ?? 0,
    inputTokens: r?.input ?? 0,
    outputTokens: r?.output ?? 0,
    since: r?.since ?? null,
  };
}
