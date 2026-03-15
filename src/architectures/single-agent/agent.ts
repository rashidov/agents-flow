import Anthropic from "@anthropic-ai/sdk";
import { TOOL_SCHEMAS } from "../../shared/tools/schemas.js";
import { dispatchTool } from "../../shared/tools/dispatcher.js";
import { listFiles } from "../../shared/tools/executor.js";
import type { Architecture, AgentResult, ActionLog } from "../../shared/types.js";

// ── Single Agent ─────────────────────────────────────────────────────────────
// Один агент делает всё: планирует, пишет код, исправляет ошибки.

const client = new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const MODEL = "claude-sonnet-4-6";

async function run(userRequest: string): Promise<AgentResult> {
  const actions: ActionLog[] = [];
  let step = 0;

  const currentFiles = listFiles();

  const system = `Ты — генератор веб-приложений на React.

Текущее состояние проекта (файлы на диске):
${currentFiles}

Правила работы:
- Перед редактированием любого файла ВСЕГДА вызывай read_file()
- После создания всех файлов запускай: npm install && npm run build
- При ошибке сборки — читай ошибку, исправляй файл и пробуй снова
- Максимум 3 попытки исправить одну ошибку

Стек: React + Vite + TypeScript + Tailwind CSS
Компоненты в src/components/`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userRequest },
  ];

  const MAX_STEPS = 30;

  while (step < MAX_STEPS) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools: TOOL_SCHEMAS,
      messages,
    });

    // Агент завершил работу
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "";
      return {
        status: "success",
        message: text,
        actions,
        steps: step,
      };
    }

    // Агент вызывает инструменты
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        step++;
        const toolInput = toolUse.input as Record<string, string>;

        console.log(`  [single][${step}] ${toolUse.name}(${JSON.stringify(toolInput).slice(0, 80)}...)`);

        const result = dispatchTool(toolUse.name, toolInput);

        actions.push({
          step,
          tool: toolUse.name,
          input: toolInput,
          result: result.slice(0, 500),
          timestamp: new Date().toISOString(),
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return {
    status: "error",
    message: `Агент остановился после ${step} шагов`,
    actions,
    steps: step,
  };
}

export const singleAgent: Architecture = {
  name: "single-agent",
  run,
};