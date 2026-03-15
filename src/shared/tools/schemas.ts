import type Anthropic from "@anthropic-ai/sdk";

// ── JSON Schema инструментов для Anthropic Tool Use ──────────────────────────

export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "create_file",
    description: "Создать или перезаписать файл в проекте",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Путь файла относительно корня проекта, например src/App.tsx",
        },
        content: {
          type: "string",
          description: "Полное содержимое файла",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description:
      "Прочитать актуальное содержимое файла с диска. ОБЯЗАТЕЛЬНО вызывай перед редактированием.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь файла" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "Получить список всех файлов проекта",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_command",
    description: "Выполнить shell-команду в папке проекта (npm install, npm run build и т.д.)",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Команда для выполнения" },
      },
      required: ["command"],
    },
  },
];
