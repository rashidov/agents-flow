import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { listFiles } from "../../shared/tools/executor.js";
import type { PlanStep, CompletedStep, StepError } from "../../shared/types.js";
import { loadMemoryBank, listMemoryKeys } from "../../memory-bank/loader.js";

// ── Планировщик ──────────────────────────────────────────────────────────────
// claude-sonnet-4-6 — 1 вызов. Разбивает задачу на конкретные шаги.

const client = new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const MODEL = "claude-sonnet-4-6";

const STEP_JSON_SCHEMA = `{
  "steps": [{
    "description": "что делаем",
    "expectedOutput": "что должно получиться",
    "targetFiles": ["путь/к/файлу.tsx"],
    "stepType": "create-file" | "modify-file" | "run-command" | "multi",
    "complexity": "low" | "high",
    "memoryKeys": ["vite-react-setup.md"]
  }]
}`;

// ── Zod-схема ────────────────────────────────────────────────────────────────

const FILE_PATH_RE = /[\w\-./]+\.\w{1,4}/g;

const PlanStepSchema = z.object({
  description: z.string().default(""),
  expectedOutput: z.string().default(""),
  targetFiles: z.array(z.string()).default([]),
  stepType: z
    .enum(["create-file", "modify-file", "run-command", "multi"])
    .default("multi"),
  complexity: z.enum(["low", "high"]).default("low"),
  memoryKeys: z.array(z.string()).default([]),
});

const PlanResponseSchema = z.object({
  steps: z.array(PlanStepSchema).min(1),
});

// ── Post-processing ──────────────────────────────────────────────────────────
// Если LLM не вернула targetFiles — пытаемся извлечь пути из description.

function normalizeSteps(steps: PlanStep[]): PlanStep[] {
  return steps.map((s) => ({
    ...s,
    targetFiles: s.targetFiles.length
      ? s.targetFiles
      : (s.description.match(FILE_PATH_RE) ?? []),
  }));
}

// ── Создание плана ───────────────────────────────────────────────────────────

export async function createPlan(userRequest: string): Promise<PlanStep[]> {
  const currentFiles = listFiles();
  const memoryBank = loadMemoryBank();
  const memoryKeysIndex = listMemoryKeys()
    .map((k) => `  - ${k.name} — ${k.description}`)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `Ты — архитектор веб-приложений. Разбей запрос на конкретные шаги.

Текущие файлы проекта: ${currentFiles}

База знаний:
${memoryBank}

Доступные файлы знаний (memory-bank) для исполнителя:
${memoryKeysIndex}

Правила:
- Каждый шаг атомарный (1 файл = 1 шаг)
- Первый шаг: создать package.json и vite.config.ts
- Последний шаг: npm install && npm run build
- Указывай ТОЧНЫЕ имена файлов
- Для каждого шага обязательно укажи targetFiles и stepType
- complexity: "low" — конфиги, типы, стили, константы (простые файлы без логики); "high" — компоненты с логикой, хуки, утилиты с вычислениями, модификация файлов
- memoryKeys: список файлов из memory-bank, которые помогут исполнителю выполнить ЭТОТ шаг. Если для шага нет подходящих знаний — пустой массив []

Ответь ТОЛЬКО в JSON (без markdown-блоков):
${STEP_JSON_SCHEMA}`,
    messages: [{ role: "user", content: userRequest }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "{}";
  const parsed = PlanResponseSchema.parse(JSON.parse(text));

  return normalizeSteps(parsed.steps);
}

// ── Перепланирование ────────────────────────────────────────────────────────
// Вызывается когда накопились ошибки и нужно пересмотреть оставшиеся шаги.

export async function replan(
  userRequest: string,
  completedSteps: CompletedStep[],
  errors: StepError[],
): Promise<PlanStep[]> {
  const currentFiles = listFiles();
  const memoryBank = loadMemoryBank();
  const memoryKeysIndex = listMemoryKeys()
    .map((k) => `  - ${k.name} — ${k.description}`)
    .join("\n");

  const completedReport = completedSteps.length
    ? completedSteps
        .map(
          (s, i) =>
            `  ${i + 1}. ${s.description} (файлы: ${s.filesCreated.join(", ") || "нет"})`,
        )
        .join("\n")
    : "  (ничего)";

  const existingFiles = completedSteps.flatMap((s) => s.filesCreated);

  const errorReport = errors
    .map((e) => `  - Шаг "${e.description}": ${e.error}`)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `Ты — архитектор веб-приложений. Нужно ПЕРЕПЛАНИРОВАТЬ оставшуюся работу.

Текущие файлы проекта: ${currentFiles}

База знаний:
${memoryBank}

Доступные файлы знаний (memory-bank) для исполнителя:
${memoryKeysIndex}

Эти файлы уже созданы и НЕ должны пересоздаваться: ${existingFiles.join(", ") || "(нет)"}

Правила:
- НЕ повторяй уже выполненные шаги
- Учти ошибки: измени подход если предыдущий не сработал
- Каждый шаг атомарный (1 файл = 1 шаг)
- Последний шаг: npm install && npm run build
- Для каждого шага обязательно укажи targetFiles и stepType
- complexity: "low" — конфиги, типы, стили, константы; "high" — компоненты с логикой, хуки, утилиты, модификация файлов
- memoryKeys: список файлов из memory-bank для исполнителя. Пустой массив [] если не нужны

Ответь ТОЛЬКО в JSON (без markdown-блоков):
${STEP_JSON_SCHEMA}`,
    messages: [
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

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "{}";
  const parsed = PlanResponseSchema.parse(JSON.parse(text));

  return normalizeSteps(parsed.steps);
}
