import { readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";

export type WalkedFile = {
  // path relative to the projects directory: the key of the file in the index
  relPath: string;
  absPath: string;
  project: string;
  ino: number;
  size: number;
  mtimeMs: number;
};

// Claude Code deletes old transcripts and session directories on its own schedule, so a
// directory or file can be gone by the time it is looked at. It is then simply not listed.
function listDirectory(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function listTranscripts(directory: string, relativeDirectory: string, found: string[]): string[] {
  for (const entry of listDirectory(directory)) {
    const relPath = `${relativeDirectory}${path.sep}${entry.name}`;
    if (entry.isDirectory()) {
      listTranscripts(`${directory}${path.sep}${entry.name}`, relPath, found);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      found.push(relPath);
    }
  }

  return found;
}

// Lists transcripts in the order the full scan read them: project by project, depth first.
// Records with the same timestamp and output in two files are settled by this order.
// A projects directory that does not exist yet lists as empty.
export function walkProjects(projectsDir: string): { projectNames: string[]; files: WalkedFile[] } {
  const projectNames: string[] = [];
  const files: WalkedFile[] = [];

  for (const entry of listDirectory(projectsDir)) {
    if (!entry.isDirectory()) {
      continue;
    }

    projectNames.push(entry.name);
    for (const relPath of listTranscripts(path.join(projectsDir, entry.name), entry.name, [])) {
      const absPath = `${projectsDir}${path.sep}${relPath}`;
      const stat = statSync(absPath, { throwIfNoEntry: false });
      if (!stat) {
        continue;
      }

      files.push({
        relPath,
        absPath,
        project: entry.name,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return { projectNames, files };
}
