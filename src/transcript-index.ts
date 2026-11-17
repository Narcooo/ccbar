import { CacheCorruptError } from "./cache-dir.js";
import { EMPTY_TAIL, readUsageRecords } from "./transcript-reader.js";
import { UpdateSession, type UpdateSummary } from "./transcript-session.js";
import { StaleStateError, loadLatestState, type IndexState } from "./transcript-store.js";
import { walkProjects, type WalkedFile } from "./transcript-walk.js";

export type UpdateResult = {
  state: IndexState;
  // project directories in listing order, as the statusline matches them in that order
  projectNames: string[];
  summary: UpdateSummary;
};

type PlannedRead = {
  file: WalkedFile;
  fileId: number;
  start: number;
  tail: number;
  rank: number;
};

// A long scan publishes its progress this often, so a render that Claude Code cancels
// (it does so whenever a newer update arrives) leaves work behind for the next one.
const CHECKPOINT_MS = 500;

// Compares the listing with the file table: which files have new bytes, and which records
// have to go because their file vanished or no longer is the file that was read.
function planRound(
  session: UpdateSession,
  files: WalkedFile[],
  summary: UpdateSummary,
): { reads: PlannedRead[]; removed: Set<number> } {
  const listed = new Set<string>();
  const removed = new Set<number>();
  const reads: PlannedRead[] = [];

  files.forEach((file, rank) => {
    listed.add(file.relPath);
    const entry = session.state.files[file.relPath];

    if (entry) {
      const [fileId, ino, size, mtimeMs, offset, tail] = entry;
      const sameFile = ino === file.ino;

      if (sameFile && size === file.size && mtimeMs === file.mtimeMs) {
        session.ranks.set(fileId, rank);
        return;
      }

      if (sameFile && file.size > size) {
        session.ranks.set(fileId, rank);
        reads.push({ file, fileId, start: offset, tail, rank });
        return;
      }

      // replaced (new inode), truncated, or rewritten at the same size
      removed.add(fileId);
      delete session.state.files[file.relPath];
      summary.filesRescanned += 1;
    }

    const fileId = session.nextFileId();
    session.ranks.set(fileId, rank);
    reads.push({ file, fileId, start: 0, tail: EMPTY_TAIL, rank });
  });

  for (const [relPath, entry] of Object.entries(session.state.files)) {
    if (!listed.has(relPath)) {
      removed.add(entry[0]);
      delete session.state.files[relPath];
      summary.filesRemoved += 1;
    }
  }

  return { reads, removed };
}

// Reads the new bytes of one file into the index and records how far it got.
function readPlanned(session: UpdateSession, read: PlannedRead, summary: UpdateSummary): void {
  const { file, rank } = read;
  const projectIndex = session.projectIndex(file.project);
  let { fileId, start, tail } = read;

  for (;;) {
    const result =
      file.size === start
        ? ({ status: "ok", offset: start, tail } as const)
        : readUsageRecords(file.absPath, start, file.size, tail, (record) => {
            session.applyRecord(projectIndex, fileId, record);
          });

    if (result.status === "missing") {
      // deleted since it was listed: whatever the index held for it goes, as it would
      // have if the listing had been taken a moment later
      if (session.state.files[file.relPath]) {
        session.removeFiles(new Set([fileId]));
        delete session.state.files[file.relPath];
        summary.filesRemoved += 1;
      }
      return;
    }

    if (result.status === "ok") {
      session.state.files[file.relPath] = [fileId, file.ino, file.size, file.mtimeMs, result.offset, result.tail];
      summary.filesRead += 1;
      summary.bytesRead += file.size - start;
      return;
    }

    // the file grew, but the bytes already consumed changed: it was rewritten, not appended to
    session.removeFiles(new Set([fileId]));
    delete session.state.files[file.relPath];
    summary.filesRescanned += 1;
    fileId = session.nextFileId();
    session.ranks.set(fileId, rank);
    start = 0;
    tail = EMPTY_TAIL;
  }
}

// Brings the index up to date with one listing of the transcripts. Returns the published
// state, or null when another process published first and the round has to start over.
function runRound(
  indexDir: string,
  files: WalkedFile[],
  generation: number,
  state: IndexState,
  checkpointMs: number,
  summary: UpdateSummary,
): IndexState | null {
  const session = new UpdateSession(indexDir, generation, state, summary);
  const { reads, removed } = planRound(session, files, summary);

  if (reads.length === 0 && removed.size === 0) {
    return session.state;
  }

  if (removed.size > 0) {
    session.removeFiles(removed);
  }

  let lastCommit = performance.now();

  for (const [position, read] of reads.entries()) {
    readPlanned(session, read, summary);

    const isLast = position === reads.length - 1;
    if (!isLast && performance.now() - lastCommit >= checkpointMs) {
      if (!session.commit()) {
        return null;
      }
      lastCommit = performance.now();
    }
  }

  return session.commit() ? session.state : null;
}

export function updateTranscriptIndex(
  projectsDir: string,
  indexDir: string,
  options: { checkpointMs?: number } = {},
): UpdateResult {
  const checkpointMs = options.checkpointMs ?? CHECKPOINT_MS;
  const summary: UpdateSummary = {
    filesRead: 0,
    bytesRead: 0,
    filesRescanned: 0,
    filesRemoved: 0,
    commits: 0,
    conflicts: 0,
  };
  let staleGeneration = -1;

  for (;;) {
    // The state is loaded before the transcripts are listed, never after: every size in
    // it then comes from an older listing than this one. The other way round, a state
    // published by a concurrent render in between would describe files as larger than
    // (or absent from) this listing, which would read as truncations and deletions.
    const { generation, state } = loadLatestState(indexDir);
    const { projectNames, files } = walkProjects(projectsDir);

    try {
      const published = runRound(indexDir, files, generation, state, checkpointMs, summary);
      if (published) {
        return { state: published, projectNames, summary };
      }
    } catch (error) {
      if (!(error instanceof StaleStateError)) {
        throw error;
      }

      // A shard disappears when a newer generation replaces it. If no newer generation
      // exists, the newest state points at a file that is gone.
      if (generation === staleGeneration) {
        throw new CacheCorruptError(
          `ccbar transcript index is missing a shard of generation ${generation} (delete ${indexDir} to rebuild it)`,
          { cause: error },
        );
      }
      staleGeneration = generation;
    }

    summary.conflicts += 1;
  }
}
