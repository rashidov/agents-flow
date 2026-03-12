import type OpenAI from "openai";

// ── JSON Schema инструментов для OpenAI Function Calling ─────────────────────

export const TOOL_SCHEMAS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Создать или перезаписать файл в проекте",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Прочитать актуальное содержимое файла с диска. ОБЯЗАТЕЛЬНО вызывай перед редактированием.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Путь файла" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Получить список всех файлов проекта",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Выполнить shell-команду в папке проекта (npm install, npm run build и т.д.)",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Команда для выполнения" },
        },
        required: ["command"],
      },
    },
  },
];
