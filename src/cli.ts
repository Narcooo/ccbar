import { pathToFileURL } from "node:url";

import { doctorStatusline, repairStatusline, setupStatusline } from "./install.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? "render";

  if (command === "setup") {
    await setupStatusline();
    process.stdout.write("ccbar statusline configured\n");
    return;
  }

  if (command === "repair") {
    const repaired = await repairStatusline();
    if (repaired) {
      process.stdout.write("ccbar statusline repaired\n");
    }
    return;
  }

  if (command === "doctor") {
    const report = await doctorStatusline();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
