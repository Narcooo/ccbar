import type { UsageRecord } from "./transcript-reader.js";
import {
  TIME_SLOT_MS,
  commitState,
  readShard,
  type Candidate,
  type IndexState,
  type Shard,
} from "./transcript-store.js";

export type UpdateSummary = {
  filesRead: number;
  bytesRead: number;
  filesRescanned: number;
  filesRemoved: number;
  commits: number;
  conflicts: number;
};

function shardKeyOf(messageId: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < messageId.length; index += 1) {
    hash = Math.imul(hash ^ messageId.charCodeAt(index), 0x01000193);
  }

  return (hash & 0xff).toString(16).padStart(2, "0");
}

function timeSlot(timestamp: string): number | null {
  const instant = Date.parse(timestamp);

  return Number.isNaN(instant) ? null : Math.floor(instant / TIME_SLOT_MS);
}

// One update of the index on top of one published generation.
export class UpdateSession {
  private readonly loadedShards = new Map<string, Shard>();
  private readonly dirtyShards = new Set<string>();
  private readonly modelIndexes: Map<string, number>;
  private readonly projectIndexes: Map<string, number>;
  // Position of each listed file in the walk. Records of files that are no longer listed
  // are dropped before any comparison, so every candidate that is compared has a rank.
  readonly ranks = new Map<number, number>();

  constructor(
    private readonly indexDir: string,
    private generation: number,
    public state: IndexState,
    private readonly summary: UpdateSummary,
  ) {
    this.modelIndexes = new Map(state.models.map((model, index) => [model, index]));
    this.projectIndexes = new Map(state.projects.map((project, index) => [project, index]));
  }

  nextFileId(): number {
    const fileId = this.state.nextFileId;
    this.state.nextFileId += 1;
    return fileId;
  }

  projectIndex(project: string): number {
    return this.internIndex(this.projectIndexes, this.state.projects, project);
  }

  private internIndex(indexes: Map<string, number>, table: string[], value: string): number {
    const known = indexes.get(value);
    if (known !== undefined) {
      return known;
    }

    const index = table.push(value) - 1;
    indexes.set(value, index);
    return index;
  }

  private shard(key: string): Shard {
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
  private count(projectIndex: number, candidate: Candidate, sign: 1 | -1): void {
    const [, , output, slot, modelIndex, input, cacheCreation, cacheCreation5m, cacheCreation1h, cacheRead] =
      candidate;
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
  private beats(challenger: Candidate, holder: Candidate): boolean {
    if (challenger[1] !== holder[1]) {
      return challenger[1] > holder[1];
    }
    if (challenger[2] !== holder[2]) {
      return challenger[2] > holder[2];
    }
    return this.ranks.get(challenger[0])! > this.ranks.get(holder[0])!;
  }

  // Moves the winning candidate to the front and moves the totals over to it.
  private electWinner(projectIndex: number, candidates: Candidate[], counted: Candidate): void {
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

  applyRecord(projectIndex: number, fileId: number, record: UsageRecord): void {
    const shardKey = shardKeyOf(record.id);
    const shard = this.shard(shardKey);
    const key = `${projectIndex}:${record.id}`;
    const candidates = shard[key];
    const own = candidates ? candidates.findIndex((candidate) => candidate[0] === fileId) : -1;

    if (candidates && own !== -1) {
      const current = candidates[own];
      const supersedes =
        record.timestamp > current[1] || (record.timestamp === current[1] && record.output >= current[2]);
      if (!supersedes) {
        return;
      }
    }

    const candidate: Candidate = [
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
    } else {
      candidates[own] = candidate;
    }
    this.electWinner(projectIndex, candidates, counted);
  }

  // Drops every record that came from the given files. Message ids are not indexed by
  // file, so this visits every shard; it only runs when a file vanished or was rewritten.
  // Such a file was recorded by an earlier generation, so its records are all in shards
  // that the state lists.
  removeFiles(fileIds: Set<number>): void {
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
        } else {
          shard[key] = remaining;
          this.electWinner(projectIndex, remaining, counted);
        }
      }
    }
  }

  // Publishes the work so far. False means another process published first.
  commit(): boolean {
    const dirty = new Map<string, Shard>();
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
