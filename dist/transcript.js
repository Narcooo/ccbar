import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { estimateCost } from "./pricing.js";
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
export function reduceMessages(entries) {
    const messagesById = new Map();
    for (const entry of entries) {
        const messageId = entry.message?.id;
        const usage = entry.message?.usage;
        const timestamp = entry.timestamp ?? "";
        if (!messageId || !usage || !timestamp || entry.type === "progress") {
            continue;
        }
        const previous = messagesById.get(messageId);
        const currentOutputTokens = usage.output_tokens ?? 0;
        const previousOutputTokens = previous?.message?.usage?.output_tokens ?? 0;
        const shouldReplace = !previous ||
            timestamp > (previous.timestamp ?? "") ||
            (timestamp === previous.timestamp && currentOutputTokens >= previousOutputTokens);
        if (shouldReplace) {
            messagesById.set(messageId, entry);
        }
    }
    return [...messagesById.values()];
}
function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function startOfLocalWeek(date) {
    const dayStart = startOfLocalDay(date);
    const day = dayStart.getDay();
    const distanceFromMonday = (day + 6) % 7;
    dayStart.setDate(dayStart.getDate() - distanceFromMonday);
    return dayStart;
}
function startOfLocalMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
async function listJsonlFiles(dirPath) {
    const files = [];
    let entries;
    try {
        entries = await readdir(dirPath, { withFileTypes: true });
    }
    catch {
        return files;
    }
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listJsonlFiles(fullPath)));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            files.push(fullPath);
        }
    }
    return files;
}
async function readTranscriptEntries(projectDir) {
    const entries = [];
    const files = await listJsonlFiles(projectDir);
    for (const filePath of files) {
        let content;
        try {
            content = await readFile(filePath, "utf8");
        }
        catch {
            continue;
        }
        for (const line of content.split("\n")) {
            if (!line.includes('"input_tokens"')) {
                continue;
            }
            try {
                entries.push(JSON.parse(line));
            }
            catch {
                continue;
            }
        }
    }
    return entries;
}
function accumulateIntoBucket(bucket, entry, now) {
    const usage = entry.message?.usage;
    const model = entry.message?.model ?? "";
    const timestamp = entry.timestamp;
    if (!usage || !timestamp) {
        return;
    }
    const entryDate = new Date(timestamp);
    if (Number.isNaN(entryDate.getTime())) {
        return;
    }
    const totalTokens = (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
    const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    const { baseCost, cacheReadCost } = estimateCost(model, usage);
    bucket.all_tok += totalTokens;
    bucket.all_cost += baseCost;
    bucket.all_ccost += cacheReadCost;
    bucket.all_cr_tok += cacheReadTokens;
    bucket.all_in_tok += inputTokens;
    if (entryDate >= startOfLocalMonth(now)) {
        bucket.month_tok += totalTokens;
        bucket.month_cost += baseCost;
        bucket.month_ccost += cacheReadCost;
    }
    if (entryDate >= startOfLocalWeek(now)) {
        bucket.week_tok += totalTokens;
        bucket.week_cost += baseCost;
        bucket.week_ccost += cacheReadCost;
        bucket.week_cr_tok += cacheReadTokens;
        bucket.week_in_tok += inputTokens;
    }
    if (entryDate >= startOfLocalDay(now)) {
        bucket.today_tok += totalTokens;
        bucket.today_cost += baseCost;
        bucket.today_ccost += cacheReadCost;
        bucket.today_cr_tok += cacheReadTokens;
        bucket.today_in_tok += inputTokens;
    }
}
export async function scanTokenStats(projectsDir, now = new Date()) {
    const stats = {
        ...ZERO_BUCKET,
        projects: {},
    };
    let projectEntries;
    try {
        projectEntries = await readdir(projectsDir, { withFileTypes: true });
    }
    catch {
        return stats;
    }
    for (const projectEntry of projectEntries) {
        if (!projectEntry.isDirectory()) {
            continue;
        }
        const projectName = projectEntry.name;
        const projectDir = path.join(projectsDir, projectName);
        const entries = reduceMessages(await readTranscriptEntries(projectDir));
        const projectStats = { ...ZERO_BUCKET };
        for (const entry of entries) {
            accumulateIntoBucket(stats, entry, now);
            accumulateIntoBucket(projectStats, entry, now);
        }
        if (projectStats.all_tok > 0 ||
            projectStats.all_cost > 0 ||
            projectStats.all_ccost > 0) {
            stats.projects[projectName] = projectStats;
        }
    }
    return stats;
}
