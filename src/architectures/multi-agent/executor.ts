import OpenAI from "openai";
import { TOOL_SCHEMAS } from "../../shared/tools/schemas.js";
import { dispatchTool } from "../../shared/tools/dispatcher.js";
import { listFiles } from "../../shared/tools/executor.js";
import type { PlanStep, CompletedStep, ActionLog } from "../../shared/types.js";

// ── Исполнитель ──────────────────────────────────────────────────────────────
// GPT-4o-mini — дешёвая модель. Выполняет ОДИН шаг плана за раз.
// Чистый контекст на каждый шаг.

const client = new OpenAI();
const MODEL = "codex-mini-latest";

export interface StepResult {
  success: boolean;
  actions: ActionLog[];
  error?: string;
}

export async function executeStep(
  planStep: PlanStep,
  stepIndex: number,
  completedSteps: CompletedStep[],
  retryFeedback?: string
): Promise<StepResult> {
  const actions: ActionLog[] = [];
  let toolStep = 0;

  const currentFiles = listFiles();

  const retrySection = retryFeedback
    ? `\nПредыдущая попытка не удалась:\n${retryFeedback}\nИсправь проблему и не повторяй ту же ошибку.\n`
    : "";

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Ты — исполнитель. Выполни ОДНУ конкретную задачу.

Текущие файлы проекта: ${currentFiles}

Уже выполненные шаги:
${completedSteps.map((s, i) => `  ${i + 1}. ${s.description}`).join("\n") || "  (пока нет)"}
${retrySection}
Правила:
- Выполни ТОЛЬКО задачу ниже, ничего лишнего
- Перед редактированием файла — вызови read_file()
- Если нужно создать файл — используй create_file()
- Если нужно выполнить команду — используй run_command()`,
    },
    {
      role: "user",
      content: `Задача: ${planStep.description}\nОжидаемый результат: ${planStep.expectedOutput}`,
    },
  ];

  const MAX_TOOL_CALLS = 10;

  while (toolStep < MAX_TOOL_CALLS) {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      tools: TOOL_SCHEMAS,
      messages,
    });

    const choice = response.choices[0]!;

    if (choice.finish_reason === "stop") {
      return { success: true, actions };
    }

    if (choice.finish_reason === "tool_calls") {
      const toolCalls = choice.message.tool_calls ?? [];
      messages.push(choice.message);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;

        toolStep++;
        const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, string>;

        console.log(`  [executor][step ${stepIndex + 1}][${toolStep}] ${toolCall.function.name}(${JSON.stringify(toolInput).slice(0, 60)}...)`);

        const result = dispatchTool(toolCall.function.name, toolInput);

        actions.push({
          step: stepIndex * 100 + toolStep,
          tool: toolCall.function.name,
          input: toolInput,
          result: result.slice(0, 500),
          timestamp: new Date().toISOString(),
        });

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
    success: false,
    actions,
    error: `Шаг не завершён за ${MAX_TOOL_CALLS} вызовов`,
  };
}