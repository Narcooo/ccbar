import { estimateCost } from "./pricing.js";
import { updateTranscriptIndex } from "./transcript-index.js";
import { TIME_SLOT_MS, resolveIndexDir, type IndexState, type TokenRow } from "./transcript-store.js";

type StatsBucket = {
  today_tok: number;
  today_cost: number;
  today_ccost: number;
  today_cr_tok: number;
  today_in_tok: number;
  week_tok: number;
  week_cost: number;
  week_ccost: number;
  week_cr_tok: number;
  week_in_tok: number;
  month_tok: number;
  month_cost: number;
  month_ccost: number;
  all_tok: number;
  all_cost: number;
  all_ccost: number;
  all_cr_tok: number;
  all_in_tok: number;
};

export type TokenStats = StatsBucket & {
  projects: Record<string, StatsBucket>;
};

const ZERO_BUCKET: StatsBucket = {
  today_tok: 0,
  today_cost: 0,
  today_ccost: 0,
  today_cr_tok: 0,
  today_in_tok: 0,
  week_tok: 0,
  week_cost: 0,
  week_ccost: 0,
  week_cr_tok: 0,
  week_in_tok: 0,
  month_tok: 0,
  month_cost: 0,
  month_ccost: 0,
  all_tok: 0,
  all_cost: 0,
  all_ccost: 0,
  all_cr_tok: 0,
  all_in_tok: 0,
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date): Date {
  const dayStart = startOfLocalDay(date);
  const distanceFromMonday = (dayStart.getDay() + 6) % 7;
  dayStart.setDate(dayStart.getDate() - distanceFromMonday);
  return dayStart;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addBucket(target: StatsBucket, source: StatsBucket): StatsBucket {
  const sum = { ...target };
  for (const field of Object.keys(ZERO_BUCKET) as (keyof StatsBucket)[]) {
    sum[field] += source[field];
  }
  return sum;
}

// The index stores token counts per quarter hour and model. Which slots count as today,
// this week and this month, and what the tokens cost, is decided here on every render, so
// nothing in the cache goes stale at midnight or when the price table changes.
function summarizeProject(
  slots: Record<string, Record<string, TokenRow>>,
  models: string[],
  now: Date,
): StatsBucket {
  const todayStart = startOfLocalDay(now).getTime();
  const weekStart = startOfLocalWeek(now).getTime();
  const monthStart = startOfLocalMonth(now).getTime();
  const bucket = { ...ZERO_BUCKET };

  for (const [slot, rows] of Object.entries(slots)) {
    const slotStart = Number(slot) * TIME_SLOT_MS;

    for (const [modelIndex, row] of Object.entries(rows)) {
      const [input, output, cacheCreation, cacheCreation5m, cacheCreation1h, cacheRead] = row;
      const totalTokens = input + output + cacheCreation;
      const inputTokens = input + cacheCreation;
      const { baseCost, cacheReadCost } = estimateCost(models[Number(modelIndex)], {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreation5m + cacheCreation1h,
        cache_read_input_tokens: cacheRead,
        cache_creation: {
          ephemeral_5m_input_tokens: cacheCreation5m,
          ephemeral_1h_input_tokens: cacheCreation1h,
        },
      });

      bucket.all_tok += totalTokens;
      bucket.all_cost += baseCost;
      bucket.all_ccost += cacheReadCost;
      bucket.all_cr_tok += cacheRead;
      bucket.all_in_tok += inputTokens;

      if (slotStart >= monthStart) {
        bucket.month_tok += totalTokens;
        bucket.month_cost += baseCost;
        bucket.month_ccost += cacheReadCost;
      }

      if (slotStart >= weekStart) {
        bucket.week_tok += totalTokens;
        bucket.week_cost += baseCost;
        bucket.week_ccost += cacheReadCost;
        bucket.week_cr_tok += cacheRead;
        bucket.week_in_tok += inputTokens;
      }

      if (slotStart >= todayStart) {
        bucket.today_tok += totalTokens;
        bucket.today_cost += baseCost;
        bucket.today_ccost += cacheReadCost;
        bucket.today_cr_tok += cacheRead;
        bucket.today_in_tok += inputTokens;
      }
    }
  }

  return bucket;
}

function summarize(state: IndexState, projectNames: string[], now: Date): TokenStats {
  let total = { ...ZERO_BUCKET };
  const projects: Record<string, StatsBucket> = {};

  for (const projectName of projectNames) {
    const slots = state.totals[state.projects.indexOf(projectName)];
    if (!slots) {
      continue;
    }

    const bucket = summarizeProject(slots, state.models, now);
    total = addBucket(total, bucket);

    if (bucket.all_tok > 0 || bucket.all_cost > 0 || bucket.all_ccost > 0) {
      projects[projectName] = bucket;
    }
  }

  return { ...total, projects };
}

// Token and cost totals over every transcript under `projectsDir`. Only bytes appended
// since the previous call are read; everything else comes from the index in `cacheDir`.
export async function scanTokenStats(
  projectsDir: string,
  cacheDir: string,
  now: Date = new Date(),
): Promise<TokenStats> {
  const { state, projectNames } = updateTranscriptIndex(projectsDir, resolveIndexDir(cacheDir, projectsDir));

  return summarize(state, projectNames, now);
}
