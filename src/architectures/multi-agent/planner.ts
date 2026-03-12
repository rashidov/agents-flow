import OpenAI from "openai";
import { listFiles } from "../../shared/tools/executor.js";
import type { PlanStep, CompletedStep, StepError } from "../../shared/types.js";
import { loadMemoryBank } from "../../memory-bank/loader.js";

// ── Планировщик ──────────────────────────────────────────────────────────────
// GPT-4o — 1 вызов. Разбивает задачу на конкретные шаги.

const client = new OpenAI();
const MODEL = "gpt-4o";

const STEP_JSON_SCHEMA = `{
  "steps": [{
    "description": "что делаем",
    "expectedOutput": "что должно получиться",
    "targetFiles": ["путь/к/файлу.tsx"],
    "stepType": "create-file" | "modify-file" | "run-command" | "multi",
    "validationHints": ["файл должен экспортировать компонент App"]
  }]
}`;

// ── Post-processing ──────────────────────────────────────────────────────────
// Если LLM не вернула targetFiles — пытаемся извлечь пути из description.

function normalizeSteps(steps: Partial<PlanStep>[]): PlanStep[] {
  const FILE_PATH_RE = /[\w\-./]+\.\w{1,4}/g;

  return steps.map((s) => ({
    description: s.description ?? "",
    expectedOutput: s.expectedOutput ?? "",
    targetFiles: s.targetFiles?.length ? s.targetFiles : (s.description?.match(FILE_PATH_RE) ?? []),
    stepType: s.stepType ?? "multi",
    validationHints: s.validationHints,
  }));
}

// ── Создание плана ───────────────────────────────────────────────────────────

export async function createPlan(userRequest: string): Promise<PlanStep[]> {
  const currentFiles = listFiles();
  const memoryBank = loadMemoryBank();

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ты — архитектор веб-приложений. Разбей запрос на конкретные шаги.

Текущие файлы проекта: ${currentFiles}

База знаний:
${memoryBank}

Правила:
- Каждый шаг атомарный (1 файл = 1 шаг)
- Первый шаг: создать package.json и vite.config.ts
- Последний шаг: npm install && npm run build
- Указывай ТОЧНЫЕ имена файлов
- Для каждого шага обязательно укажи targetFiles и stepType

Ответь в JSON:
${STEP_JSON_SCHEMA}`,
      },
      { role: "user", content: userRequest },
    ],
  });

  const text = response.choices[0]!.message.content ?? "{}";
  const parsed = JSON.parse(text) as { steps?: Partial<PlanStep>[] };

  if (!parsed.steps || parsed.steps.length === 0) {
    throw new Error(`Планировщик не вернул шаги:\n${text}`);
  }

  return normalizeSteps(parsed.steps);
}

// ── Перепланирование ────────────────────────────────────────────────────────
// Вызывается когда накопились ошибки и нужно пересмотреть оставшиеся шаги.

export async function replan(
  userRequest: string,
  completedSteps: CompletedStep[],
  errors: StepError[]
): Promise<PlanStep[]> {
  const currentFiles = listFiles();
  const memoryBank = loadMemoryBank();

  const completedReport = completedSteps.length
    ? completedSteps.map((s, i) => `  ${i + 1}. ${s.description} (файлы: ${s.filesCreated.join(", ") || "нет"})`).join("\n")
    : "  (ничего)";

  const existingFiles = completedSteps.flatMap((s) => s.filesCreated);

  const errorReport = errors
    .map((e) => `  - Шаг "${e.description}": ${e.error}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ты — архитектор веб-приложений. Нужно ПЕРЕПЛАНИРОВАТЬ оставшуюся работу.

Текущие файлы проекта: ${currentFiles}

База знаний:
${memoryBank}

Эти файлы уже созданы и НЕ должны пересоздаваться: ${existingFiles.join(", ") || "(нет)"}

Правила:
- НЕ повторяй уже выполненные шаги
- Учти ошибки: измени подход если предыдущий не сработал
- Каждый шаг атомарный (1 файл = 1 шаг)
- Последний шаг: npm install && npm run build
- Для каждого шага обязательно укажи targetFiles и stepType

Ответь в JSON:
${STEP_JSON_SCHEMA}`,
      },
      {
        role: "user",
        content: `Исходный запрос: ${userRequest}

Уже выполнено:
${completedReport}

Ошибки при выполнении:
${errorReport}

Составь НОВЫЙ план для оставшейся работы с учётом ошибок.`,
      },
    ],
  });

  const text = response.choices[0]!.message.content ?? "{}";
  const parsed = JSON.parse(text) as { steps?: Partial<PlanStep>[] };

  if (!parsed.steps || parsed.steps.length === 0) {
    throw new Error(`Перепланировщик не вернул шаги:\n${text}`);
  }

  return normalizeSteps(parsed.steps);
}