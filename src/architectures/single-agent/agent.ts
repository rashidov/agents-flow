import OpenAI from "openai";
import { TOOL_SCHEMAS } from "../../shared/tools/schemas.js";
import { dispatchTool } from "../../shared/tools/dispatcher.js";
import { listFiles } from "../../shared/tools/executor.js";
import type { Architecture, AgentResult, ActionLog } from "../../shared/types.js";

// ── Single Agent ─────────────────────────────────────────────────────────────
// Один агент делает всё: планирует, пишет код, исправляет ошибки.

const client = new OpenAI();
const MODEL = "gpt-4o";

async function run(userRequest: string): Promise<AgentResult> {
  const actions: ActionLog[] = [];
  let step = 0;

  const currentFiles = listFiles();

  const systemPrompt = `Ты — генератор веб-приложений на React.

Текущее состояние проекта (файлы на диске):
${currentFiles}

Правила работы:
- Перед редактированием любого файла ВСЕГДА вызывай read_file()
- После создания всех файлов запускай: npm install && npm run build
- При ошибке сборки — читай ошибку, исправляй файл и пробуй снова
- Максимум 3 попытки исправить одну ошибку

Стек: React + Vite + TypeScript + Tailwind CSS
Компоненты в src/components/`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userRequest },
  ];

  const MAX_STEPS = 30;

  while (step < MAX_STEPS) {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      tools: TOOL_SCHEMAS,
      messages,
    });

    const choice = response.choices[0]!;

    // Агент завершил работу
    if (choice.finish_reason === "stop") {
      return {
        status: "success",
        message: choice.message.content ?? "",
        actions,
        steps: step,
      };
    }

    // Агент вызывает инструменты
    if (choice.finish_reason === "tool_calls") {
      const toolCalls = choice.message.tool_calls ?? [];

      // Добавляем ответ ассистента в историю
      messages.push(choice.message);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;

        step++;
        const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, string>;

        console.log(`  [single][${step}] ${toolCall.function.name}(${JSON.stringify(toolInput).slice(0, 80)}...)`);

        const result = dispatchTool(toolCall.function.name, toolInput);

        actions.push({
          step,
          tool: toolCall.function.name,
          input: toolInput,
          result: result.slice(0, 500),
          timestamp: new Date().toISOString(),
        });

        // OpenAI: каждый tool_result — отдельное сообщение с tool_call_id
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

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
