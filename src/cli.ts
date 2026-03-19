import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { doctorStatusline, repairStatusline, setupStatusline } from "./install.js";
import { renderStatusline } from "./statusline.js";
import { scanTokenStats } from "./transcript.js";

type CliIo = {
  readStdin: () => Promise<string>;
  writeStdout: (value: string) => void;
};

function createProcessIo(): CliIo {
  return {
    readStdin: async () => {
      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(String(chunk));
      }
      return chunks.join("");
    },
    writeStdout: (value: string) => {
      process.stdout.write(value);
    },
  };
}

export async function main(
  argv: string[] = process.argv.slice(2),
  io: CliIo = createProcessIo(),
): Promise<void> {
  const command = argv[0] ?? "render";

  if (command === "setup") {
    await setupStatusline();
    io.writeStdout("ccbar statusline configured\n");
    return;
  }

  if (command === "repair") {
    const repaired = await repairStatusline();
    if (repaired) {
      io.writeStdout("ccbar statusline repaired\n");
    }
    return;
  }

  if (command === "doctor") {
    const report = await doctorStatusline();
    io.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const rawInput = await io.readStdin();
  if (!rawInput.trim()) {
    io.writeStdout("");
    return;
  }

  const input = JSON.parse(rawInput);
  const config = await loadConfig(process.env.CCBAR_CONFIG_PATH);
  const projectsDir =
    process.env.CCBAR_PROJECTS_DIR ?? path.join(os.homedir(), ".claude", "projects");
  const tokens = await scanTokenStats(projectsDir);
  const output = renderStatusline(input, {
    tokens,
    quota: null,
    columns: config.columns ?? undefined,
    config,
  });

  io.writeStdout(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
