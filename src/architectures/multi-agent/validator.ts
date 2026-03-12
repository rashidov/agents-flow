import OpenAI from "openai";
import { listFiles, readFile } from "../../shared/tools/executor.js";
import type { PlanStep, ActionLog, ValidationDecision } from "../../shared/types.js";

// ── Валидатор ────────────────────────────────────────────────────────────────
// Двухфазная валидация:
//   Фаза 1 — детерминированные проверки (без LLM): файлы, exit code
//   Фаза 2 — LLM-проверка семантики (только если Фаза 1 прошла + есть hints)

const client = new OpenAI();
const MODEL = "gpt-4o-mini";

// ── Фаза 1: Детерминированные проверки ───────────────────────────────────────

function checkDeterministic(
  planStep: PlanStep,
  stepActions: ActionLog[]
): ValidationDecision | null {
  const existingFiles = new Set(listFiles().split("\n").map((f) => f.trim()));

  // Проверка наличия и непустоты целевых файлов
  if (planStep.stepType !== "run-command" && planStep.targetFiles.length > 0) {
    for (const target of planStep.targetFiles) {
      const normalizedTarget = target.replace(/^\.\//, "");
      const found = [...existingFiles].some(
        (f) => f === normalizedTarget || f.endsWith(normalizedTarget)
      );

      if (!found) {
        return {
          action: "retry",
          reason: `Файл не создан: ${target}`,
          feedback: `Файл "${target}" отсутствует на диске. Создай его с помощью create_file().`,
        };
      }

      const content = readFile(normalizedTarget);
      if (!content || content.trim().length === 0) {
        return {
          action: "retry",
          reason: `Файл пустой: ${target}`,
          feedback: `Файл "${target}" существует, но пустой. Запиши правильное содержимое.`,
        };
      }
    }
  }

  // Проверка ошибок в run-command шагах
  if (planStep.stepType === "run-command") {
    const cmdActions = stepActions.filter((a) => a.tool === "run_command");
    for (const action of cmdActions) {
      const result = action.result.toLowerCase();
      if (
        result.includes("error") ||
        result.includes("failed") ||
        result.includes("exit code 1") ||
        result.includes("npm warn") && result.includes("could not resolve")
      ) {
        const excerpt = action.result.slice(0, 300);
        return {
          action: "retry",
          reason: `Команда завершилась с ошибкой`,
          feedback: `Ошибка выполнения команды:\n${excerpt}\nИсправь ошибки в файлах и повтори.`,
        };
      }
    }
  }

  return null; // все детерминированные проверки прошли
}

// ── Фаза 2: LLM семантическая проверка ───────────────────────────────────────

async function checkSemantic(
  planStep: PlanStep,
  stepError?: string
): Promise<ValidationDecision> {
  const currentFiles = listFiles();

  // Читаем содержимое целевых файлов для передачи в LLM
  const fileContents = planStep.targetFiles
    .map((f) => {
      const content = readFile(f.replace(/^\.\//, ""));
      return content ? `=== ${f} ===\n${content.slice(0, 800)}` : null;
    })
    .filter(Boolean)
    .join("\n\n");

  const hintsSection = planStep.validationHints?.length
    ? `\nОжидаемые свойства файлов:\n${planStep.validationHints.map((h) => `  - ${h}`).join("\n")}`
    : "";

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 256,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ты — валидатор кода. Проверяешь результат выполнения шага.

Все файлы проекта: ${currentFiles}
${hintsSection}

Ответь в JSON:
{ "action": "continue" }                               — шаг выполнен корректно
{ "action": "retry", "reason": "...", "feedback": "..." } — нужно исправить (feedback = конкретная инструкция)
{ "action": "abort", "reason": "..." }                 — критическая ошибка, нужно перепланировать`,
      },
      {
        role: "user",
        content: `Шаг: ${planStep.description}
Ожидалось: ${planStep.expectedOutput}
${stepError ? `Ошибка исполнителя: ${stepError}` : "Исполнитель завершил без ошибок."}

Содержимое файлов:
${fileContents || "(нет)"}

Проверь и реши: continue, retry или abort?`,
      },
    ],
  });

  const text = response.choices[0]!.message.content ?? "{}";

  try {
    return JSON.parse(text) as ValidationDecision;
  } catch {
    return { action: "continue" };
  }
}

// ── Публичный интерфейс ───────────────────────────────────────────────────────

export async function validateStep(
  planStep: PlanStep,
  stepActions: ActionLog[],
  stepError?: string
): Promise<ValidationDecision> {
  // Фаза 1: быстрые детерминированные проверки
  const deterministicResult = checkDeterministic(planStep, stepActions);
  if (deterministicResult) {
    const reason = deterministicResult.action !== "continue" ? deterministicResult.reason : "";
    console.log(`  [validator] Фаза 1 не прошла: ${reason}`);
    return deterministicResult;
  }

  // Фаза 2: LLM только для сложных шагов (с hints, multi, или при ошибке)
  const needsLLM =
    stepError ||
    planStep.stepType === "multi" ||
    (planStep.validationHints && planStep.validationHints.length > 0);

  if (needsLLM) {
    return checkSemantic(planStep, stepError);
  }

  return { action: "continue" };
}
