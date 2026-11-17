import { CacheCorruptError, recordRebuild } from "./cache-dir.js";
import { estimateCost } from "./pricing.js";
import { updateTranscriptIndex } from "./transcript-index.js";
import { TIME_SLOT_MS, discardIndex, resolveIndexDir, } from "./transcript-store.js";
const ZERO_BUCKET = {
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
function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function startOfLocalWeek(date) {
    const dayStart = startOfLocalDay(date);
    const distanceFromMonday = (dayStart.getDay() + 6) % 7;
    dayStart.setDate(dayStart.getDate() - distanceFromMonday);
    return dayStart;
}
function startOfLocalMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addBucket(target, source) {
    const sum = { ...target };
    for (const field of Object.keys(ZERO_BUCKET)) {
        sum[field] += source[field];
    }
    return sum;
}
// The index stores token counts per quarter hour and model. Which slots count as today,
// this week and this month, and what the tokens cost, is decided here on every render, so
// nothing in the cache goes stale at midnight or when the price table changes.
function summarizeProject(slots, models, now) {
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
function summarize(state, projectNames, now) {
    let total = { ...ZERO_BUCKET };
    const projects = {};
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
// Brings the index up to date. A damaged index file is recorded, the index is discarded
// and built again from the transcripts, exactly as on a first run. Only one rebuild is
// attempted: if the fresh index is damaged too, the error surfaces.
function updateIndex(projectsDir, cacheDir) {
    const indexDir = resolveIndexDir(cacheDir, projectsDir);
    try {
        return updateTranscriptIndex(projectsDir, indexDir);
    }
    catch (error) {
        if (!(error instanceof CacheCorruptError)) {
            throw error;
        }
        recordRebuild(cacheDir, error);
        discardIndex(indexDir);
        return updateTranscriptIndex(projectsDir, indexDir);
    }
}
// Token and cost totals over every transcript under `projectsDir`. Only bytes appended
// since the previous call are read; everything else comes from the index in `cacheDir`.
export async function scanTokenStats(projectsDir, cacheDir, now = new Date()) {
    const { state, projectNames } = updateIndex(projectsDir, cacheDir);
    return summarize(state, projectNames, now);
}
