import { TIME_SLOT_MS, commitState, readShard, } from "./transcript-store.js";
function shardKeyOf(messageId) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < messageId.length; index += 1) {
        hash = Math.imul(hash ^ messageId.charCodeAt(index), 0x01000193);
    }
    return (hash & 0xff).toString(16).padStart(2, "0");
}
function timeSlot(timestamp) {
    const instant = Date.parse(timestamp);
    return Number.isNaN(instant) ? null : Math.floor(instant / TIME_SLOT_MS);
}
// One update of the index on top of one published generation.
export class UpdateSession {
    indexDir;
    generation;
    state;
    summary;
    loadedShards = new Map();
    dirtyShards = new Set();
    modelIndexes;
    projectIndexes;
    // Position of each listed file in the walk. Records of files that are no longer listed
    // are dropped before any comparison, so every candidate that is compared has a rank.
    ranks = new Map();
    constructor(indexDir, generation, state, summary) {
        this.indexDir = indexDir;
        this.generation = generation;
        this.state = state;
        this.summary = summary;
        this.modelIndexes = new Map(state.models.map((model, index) => [model, index]));
        this.projectIndexes = new Map(state.projects.map((project, index) => [project, index]));
    }
    nextFileId() {
        const fileId = this.state.nextFileId;
        this.state.nextFileId += 1;
        return fileId;
    }
    projectIndex(project) {
        return this.internIndex(this.projectIndexes, this.state.projects, project);
    }
    internIndex(indexes, table, value) {
        const known = indexes.get(value);
        if (known !== undefined) {
            return known;
        }
        const index = table.push(value) - 1;
        indexes.set(value, index);
        return index;
    }
    shard(key) {
        const loaded = this.loadedShards.get(key);
        if (loaded) {
            return loaded;
        }
        const fileName = this.state.shards[key];
        const shard = fileName === undefined ? {} : readShard(this.indexDir, fileName);
        this.loadedShards.set(key, shard);
        return shard;
    }
    // Adds (sign 1) or removes (sign -1) one record from the totals.
    count(projectIndex, candidate, sign) {
        const [, , output, slot, modelIndex, input, cacheCreation, cacheCreation5m, cacheCreation1h, cacheRead] = candidate;
        if (slot === null) {
            // an unparseable timestamp still takes part in the dedupe but is never counted
            return;
        }
        const slots = (this.state.totals[projectIndex] ??= {});
        const models = (slots[slot] ??= {});
        const row = (models[modelIndex] ??= [0, 0, 0, 0, 0, 0]);
        row[0] += sign * input;
        row[1] += sign * output;
        row[2] += sign * cacheCreation;
        row[3] += sign * cacheCreation5m;
        row[4] += sign * cacheCreation1h;
        row[5] += sign * cacheRead;
        if (row.every((value) => value === 0)) {
            delete models[modelIndex];
            if (Object.keys(models).length === 0) {
                delete slots[slot];
                if (Object.keys(slots).length === 0) {
                    delete this.state.totals[projectIndex];
                }
            }
        }
    }
    // The full scan kept, per message id, the last record in scan order among those with
    // the greatest (timestamp, output).
    beats(challenger, holder) {
        if (challenger[1] !== holder[1]) {
            return challenger[1] > holder[1];
        }
        if (challenger[2] !== holder[2]) {
            return challenger[2] > holder[2];
        }
        return this.ranks.get(challenger[0]) > this.ranks.get(holder[0]);
    }
    // Moves the winning candidate to the front and moves the totals over to it.
    electWinner(projectIndex, candidates, counted) {
        let best = 0;
        for (let index = 1; index < candidates.length; index += 1) {
            if (this.beats(candidates[index], candidates[best])) {
                best = index;
            }
        }
        const winner = candidates[best];
        candidates[best] = candidates[0];
        candidates[0] = winner;
        if (winner !== counted) {
            this.count(projectIndex, counted, -1);
            this.count(projectIndex, winner, 1);
        }
    }
    applyRecord(projectIndex, fileId, record) {
        const shardKey = shardKeyOf(record.id);
        const shard = this.shard(shardKey);
        const key = `${projectIndex}:${record.id}`;
        const candidates = shard[key];
        const own = candidates ? candidates.findIndex((candidate) => candidate[0] === fileId) : -1;
        if (candidates && own !== -1) {
            const current = candidates[own];
            const supersedes = record.timestamp > current[1] || (record.timestamp === current[1] && record.output >= current[2]);
            if (!supersedes) {
                return;
            }
        }
        const candidate = [
            fileId,
            record.timestamp,
            record.output,
            timeSlot(record.timestamp),
            this.internIndex(this.modelIndexes, this.state.models, record.model),
            record.input,
            record.cacheCreation,
            record.cacheCreation5m,
            record.cacheCreation1h,
            record.cacheRead,
        ];
        this.dirtyShards.add(shardKey);
        if (!candidates) {
            shard[key] = [candidate];
            this.count(projectIndex, candidate, 1);
            return;
        }
        const counted = candidates[0];
        if (own === -1) {
            candidates.push(candidate);
        }
        else {
            candidates[own] = candidate;
        }
        this.electWinner(projectIndex, candidates, counted);
    }
    // Drops every record that came from the given files. Message ids are not indexed by
    // file, so this visits every shard; it only runs when a file vanished or was rewritten.
    // Such a file was recorded by an earlier generation, so its records are all in shards
    // that the state lists.
    removeFiles(fileIds) {
        for (const shardKey of Object.keys(this.state.shards)) {
            const shard = this.shard(shardKey);
            for (const [key, candidates] of Object.entries(shard)) {
                if (!candidates.some((candidate) => fileIds.has(candidate[0]))) {
                    continue;
                }
                const projectIndex = Number(key.slice(0, key.indexOf(":")));
                const counted = candidates[0];
                const remaining = candidates.filter((candidate) => !fileIds.has(candidate[0]));
                this.dirtyShards.add(shardKey);
                if (remaining.length === 0) {
                    delete shard[key];
                    this.count(projectIndex, counted, -1);
                }
                else {
                    shard[key] = remaining;
                    this.electWinner(projectIndex, remaining, counted);
                }
            }
        }
    }
    // Publishes the work so far. False means another process published first.
    commit() {
        const dirty = new Map();
        for (const key of this.dirtyShards) {
            dirty.set(key, this.shard(key));
        }
        const published = commitState(this.indexDir, this.generation, this.state, dirty);
        if (!published) {
            return false;
        }
        this.state = published;
        this.generation += 1;
        this.dirtyShards.clear();
        this.summary.commits += 1;
        return true;
    }
}
