import Anthropic from "@anthropic-ai/sdk";
import { TOOL_SCHEMAS } from "../../shared/tools/schemas.js";
import { dispatchTool } from "../../shared/tools/dispatcher.js";
import { listFiles } from "../../shared/tools/executor.js";
import { loadMemoryFiles } from "../../memory-bank/loader.js";
import type { PlanStep, CompletedStep, ActionLog } from "../../shared/types.js";

// ── Исполнитель ──────────────────────────────────────────────────────────────
// Модель выбирается по complexity шага:
//   low  → Haiku  (быстро, дёшево — конфиги, типы, стили)
//   high → Sonnet (умнее — компоненты с логикой, хуки, утилиты)

const client = new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });

const MODELS: Record<PlanStep["complexity"], string> = {
  low: "claude-haiku-4-5-20251001",
  high: "claude-sonnet-4-6",
};

const TOOL_LIMITS: Record<PlanStep["complexity"], number> = {
  low: 10,
  high: 20,
};

export interface StepMetrics {
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StepResult {
  success: boolean;
  actions: ActionLog[];
  error?: string;
  metrics: StepMetrics;
}

export async function executeStep(
  planStep: PlanStep,
  stepIndex: number,
  completedSteps: CompletedStep[],
  retryFeedback?: string
): Promise<StepResult> {
  const actions: ActionLog[] = [];
  let toolStep = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const stepStartTime = Date.now();

  const currentFiles = listFiles();
  const model = MODELS[planStep.complexity];
  const maxToolCalls = TOOL_LIMITS[planStep.complexity];
  const memory = loadMemoryFiles(planStep.memoryKeys);

  const retrySection = retryFeedback
    ? `\nПредыдущая попытка не удалась:\n${retryFeedback}\nИсправь проблему и не повторяй ту же ошибку.\n`
    : "";

  const memorySection = memory
    ? `\nБаза знаний (используй как референс):\n${memory}\n`
    : "";

  const system = `Ты — исполнитель. Выполни ОДНУ конкретную задачу.

Текущие файлы проекта: ${currentFiles}

Уже выполненные шаги:
${completedSteps.map((s, i) => `  ${i + 1}. ${s.description}`).join("\n") || "  (пока нет)"}
${retrySection}${memorySection}
Правила:
- Выполни ТОЛЬКО задачу ниже, ничего лишнего
- Перед редактированием файла — вызови read_file()
- Если нужно создать файл — используй create_file()
- Если нужно выполнить команду — используй run_command()`;

  console.log(`  [executor] Модель: ${model}, лимит вызовов: ${maxToolCalls}, memory: [${planStep.memoryKeys.join(", ")}]`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Задача: ${planStep.description}\nОжидаемый результат: ${planStep.expectedOutput}`,
    },
  ];

  while (toolStep < maxToolCalls) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      tools: TOOL_SCHEMAS,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const metrics: StepMetrics = {
        model,
        durationMs: Date.now() - stepStartTime,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
      console.log(`  [executor] Завершён: ${metrics.durationMs}ms, ${metrics.inputTokens}+${metrics.outputTokens} токенов`);
      return { success: true, actions, metrics };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolStep++;
        const toolInput = toolUse.input as Record<string, string>;

        console.log(`  [executor][step ${stepIndex + 1}][${toolStep}] ${toolUse.name}(${JSON.stringify(toolInput).slice(0, 60)}...)`);

        const result = dispatchTool(toolUse.name, toolInput);

        actions.push({
          step: stepIndex * 100 + toolStep,
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

  const metrics: StepMetrics = {
    model,
    durationMs: Date.now() - stepStartTime,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
  console.log(`  [executor] Не завершён: ${metrics.durationMs}ms, ${metrics.inputTokens}+${metrics.outputTokens} токенов`);
  return {
    success: false,
    actions,
    error: `Шаг не завершён за ${maxToolCalls} вызовов`,
    metrics,
  };
}