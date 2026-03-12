import { createFile, readFile, listFiles, runCommand } from "./executor.js";

type ToolInput = Record<string, string>;

/** Мост между Claude API tool_use и реальными функциями */
export function dispatchTool(name: string, input: ToolInput): string {
  switch (name) {
    case "create_file":
      return createFile(input["path"] ?? "", input["content"] ?? "");
    case "read_file":
      return readFile(input["path"] ?? "");
    case "list_files":
      return listFiles();
    case "run_command":
      return runCommand(input["command"] ?? "");
    default:
      return `ERROR: неизвестный инструмент — ${name}`;
  }
}
