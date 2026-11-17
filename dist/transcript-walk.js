import { readdirSync, statSync } from "node:fs";
import path from "node:path";
// Claude Code deletes old transcripts and session directories on its own schedule, so a
// directory or file can be gone by the time it is looked at. It is then simply not listed.
function listDirectory(directory) {
    try {
        return readdirSync(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
function listTranscripts(directory, relativeDirectory, found) {
    for (const entry of listDirectory(directory)) {
        const relPath = `${relativeDirectory}${path.sep}${entry.name}`;
        if (entry.isDirectory()) {
            listTranscripts(`${directory}${path.sep}${entry.name}`, relPath, found);
        }
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            found.push(relPath);
        }
    }
    return found;
}
// Lists transcripts in the order the full scan read them: project by project, depth first.
// Records with the same timestamp and output in two files are settled by this order.
// A projects directory that does not exist yet lists as empty.
export function walkProjects(projectsDir) {
    const projectNames = [];
    const files = [];
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
