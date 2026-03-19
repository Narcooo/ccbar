export type ClaudeSettings = Record<string, unknown> & {
  statusLine?: {
    type: string;
    command: string;
    padding?: number;
  };
};

export function applyStatuslineSettings(
  settings: ClaudeSettings,
  launcherPath: string,
): ClaudeSettings {
  return {
    ...settings,
    statusLine: {
      type: "command",
      command: launcherPath,
      padding: 0,
    },
  };
}
