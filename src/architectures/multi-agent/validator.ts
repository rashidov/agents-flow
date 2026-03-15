import postcss from "postcss";
import { readFile } from "../../shared/tools/executor.js";
import type {
  PlanStep,
  ActionLog,
  ValidationDecision,
} from "../../shared/types.js";

// ── Валидатор ────────────────────────────────────────────────────────────────
// Детерминированная валидация (без LLM).
// Проверяет реальные действия executor'а (actions), а НЕ ожидания плана.
//   1. Executor вызвал хотя бы один инструмент
//   2. Созданные файлы не пустые
//   3. CSS файлы валидны (postcss)
//   4. Команды завершились с exit_code=0

// ── Извлечение реально созданных/изменённых файлов из actions ─────────────────

function getCreatedFiles(stepActions: ActionLog[]): string[] {
  return stepActions
    .filter((a) => a.tool === "create_file" && a.result.startsWith("OK"))
    .map((a) => (a.input as Record<string, string>).path)
    .filter(Boolean);
}

// ── Проверка: executor что-то сделал? ────────────────────────────────────────

function checkActionsExist(
  planStep: PlanStep,
  stepActions: ActionLog[],
): ValidationDecision | null {
  if (planStep.stepType === "run-command") return null;

  const writes = stepActions.filter(
    (a) => a.tool === "create_file" || a.tool === "edit_file",
  );

  if (writes.length === 0) {
    return {
      action: "retry",
      reason: "Executor не создал и не изменил ни одного файла",
      feedback:
        "Ни один файл не был создан или изменён. Используй create_file() для создания файлов.",
    };
  }

  return null;
}

// ── Проверка: созданные файлы не пустые ──────────────────────────────────────

function checkFilesNotEmpty(stepActions: ActionLog[]): ValidationDecision | null {
  const createdFiles = getCreatedFiles(stepActions);

  for (const filePath of createdFiles) {
    const content = readFile(filePath);
    if (!content || content.trim().length === 0) {
      return {
        action: "retry",
        reason: `Файл пустой: ${filePath}`,
        feedback: `Файл "${filePath}" существует, но пустой. Запиши правильное содержимое.`,
      };
    }
  }

  return null;
}

// ── Синтаксис CSS через postcss ──────────────────────────────────────────────
// Проверяем CSS файлы, которые реально были созданы в этом шаге.

function checkCSSSyntax(stepActions: ActionLog[]): ValidationDecision | null {
  const cssFiles = getCreatedFiles(stepActions).filter((f) => f.endsWith(".css"));

  for (const filePath of cssFiles) {
    const content = readFile(filePath);
    if (!content || content.startsWith("ERROR")) continue;

    try {
      postcss.parse(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        action: "retry",
        reason: `Невалидный CSS в ${filePath}: ${message}`,
        feedback: `CSS файл "${filePath}" содержит синтаксическую ошибку: ${message}. Исправь синтаксис.`,
      };
    }
  }

  return null;
}

// ── Проверка run-command ─────────────────────────────────────────────────────
// Проверяем только exit_code — это надёжный индикатор. Слова "error"/"failed"
// в stdout могут быть warnings и ложными срабатываниями.

function checkRunCommand(
  planStep: PlanStep,
  stepActions: ActionLog[],
): ValidationDecision | null {
  if (planStep.stepType !== "run-command") return null;

  const cmdActions = stepActions.filter((a) => a.tool === "run_command");

  if (cmdActions.length === 0) {
    return {
      action: "retry",
      reason: "Команда не была выполнена",
      feedback: "Используй run_command() для выполнения команды.",
    };
  }

  for (const action of cmdActions) {
    if (action.result.startsWith("exit_code=1")) {
      const excerpt = action.result.slice(0, 500);
      return {
        action: "retry",
        reason: "Команда завершилась с ошибкой",
        feedback: `Ошибка выполнения команды:\n${excerpt}\nИсправь ошибки и повтори.`,
      };
    }
  }

  return null;
}

// ── Публичный интерфейс ───────────────────────────────────────────────────────

export async function validateStep(
  planStep: PlanStep,
  stepActions: ActionLog[],
  _stepError?: string,
): Promise<ValidationDecision> {
  const checks = [
    checkActionsExist(planStep, stepActions),
    checkFilesNotEmpty(stepActions),
    checkCSSSyntax(stepActions),
    checkRunCommand(planStep, stepActions),
  ];

  for (const result of checks) {
    if (result && result.action !== "continue") {
      console.log(`  [validator] ${result.reason}`);
      return result;
    }
  }

  return { action: "continue" };
}