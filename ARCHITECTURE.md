# Архитектура: Multi-Agent на LangGraph

## Контекст

Проект генерирует веб-приложения (React + Vite + TypeScript) с помощью LLM-агентов. Основная архитектура — граф на LangGraph с 4 узлами: планировщик, исполнитель, валидатор, перепланировщик.

Старый orchestrator.ts (простой for-цикл) заменяется на graph.ts.

---

## Жизненный цикл графа

```
START → plan → execute → validate ──[continue]──► execute (следующий шаг)
                                  ──[continue, последний]──► END
                                  ──[retry, < MAX]──► execute (тот же шаг + feedback)
                                  ──[retry, >= MAX]──► replan
                                  ──[abort]──► replan
                           replan ──[replanCount <= MAX]──► execute
                           replan ──[replanCount > MAX или пустой план]──► END
```

**Лимиты:** MAX_RETRIES = 2 на шаг, MAX_REPLANS = 2 на сессию.

---

## State графа

```typescript
{
  userRequest:      string,
  plan:             PlanStep[],
  currentStepIndex: number,
  completedSteps:   CompletedStep[],   // { description, filesCreated[] }
  errors:           StepError[],       // { stepIndex, description, error }
  retryCount:       number,
  replanCount:      number,
  actions:          ActionLog[],
  lastValidation:   ValidationDecision,
  status:           "running" | "success" | "error",
}
```

---

## Расширенный PlanStep

```typescript
interface PlanStep {
  description: string;
  expectedOutput: string;
  targetFiles: string[];              // ["src/components/Button.tsx"]
  stepType: "create-file" | "modify-file" | "run-command" | "multi";
  validationHints?: string[];         // ["must export default function"]
}
```

Планировщик возвращает `targetFiles` и `stepType` — валидатор проверяет результат без LLM.

---

## Узлы графа

### 1. Планировщик (planner.ts) — claude-sonnet-4-6

**Валидация ответа LLM — Zod:**

Ответ модели парсится через `PlanResponseSchema.parse()`:
```typescript
const PlanStepSchema = z.object({
  description:     z.string().default(""),
  expectedOutput:  z.string().default(""),
  targetFiles:     z.array(z.string()).default([]),
  stepType:        z.enum(["create-file", "modify-file", "run-command", "multi"]).default("multi"),
  validationHints: z.array(z.string()).optional(),
});

const PlanResponseSchema = z.object({
  steps: z.array(PlanStepSchema).min(1),
});
```

Если LLM вернёт невалидный `stepType`, пропустит обязательное поле или вернёт пустой массив — Zod выбросит ошибку сразу на границе парсинга. Дефолты (`""`, `[]`, `"multi"`) проставляются схемой.

**createPlan(userRequest):**
- Промпт требует `targetFiles`, `stepType`, `validationHints` в каждом шаге
- Правила: 1 файл = 1 шаг, конфиги первыми, `npm install && npm run build` последним
- Post-processing: если `targetFiles` пустой — извлекаем пути из description регексом

**replan(userRequest, completedSteps, errors):**
- Принимает `CompletedStep[]` с файлами и `StepError[]` с feedback от валидатора
- Промпт: "Эти файлы уже созданы: [список]. НЕ пересоздавай их."
- Меняет подход если предыдущий не сработал

### 2. Исполнитель (executor.ts) — claude-haiku-4-5-20251001

- Выполняет ОДИН шаг плана через tool loop (макс 10 tool calls)
- Параметр `retryFeedback?: string` — при retry в промпт добавляется: "Предыдущая попытка не удалась: {feedback}. Исправь проблему."
- Tools: `create_file`, `read_file`, `list_files`, `run_command`

### 3. Валидатор (validator.ts) — двухфазный

**Фаза 1: Детерминированные проверки (без LLM)**

| stepType | Проверка |
|---|---|
| `create-file` | Файл из `targetFiles` существует и не пустой |
| `modify-file` | Файл существует |
| `run-command` | Последний action не содержит ошибку |
| `multi` | Все файлы из `targetFiles` существуют |

Не прошла → `{ action: "retry", reason, feedback }` без вызова LLM.

**Фаза 2: LLM-проверка (claude-haiku-4-5-20251001, только если Фаза 1 прошла)**

- Вызывается для шагов с `validationHints` или `stepType === "multi"`
- Получает содержимое файлов с диска + hints
- Пропускается для простых `create-file` → экономия API-вызовов

**ValidationDecision:**
```typescript
type ValidationDecision =
  | { action: "continue" }
  | { action: "retry"; reason: string; feedback: string }
  | { action: "abort"; reason: string }
```

### 4. Перепланировщик (replanNode в graph.ts)

- Вызывается когда retry исчерпаны или validator вернул abort
- Получает полный отчёт: completedSteps + errors с feedback
- Инкрементирует `replanCount`
- Создаёт новый план через `replan()` в planner.ts

---

## Структура файлов

```
src/
├── main.ts                           # CLI, реестр архитектур: single, multi
├── architectures/
│   ├── single-agent/agent.ts         # Один GPT-4o агент (без изменений)
│   └── multi-agent/
│       ├── graph.ts                  # LangGraph StateGraph — основной оркестратор
│       ├── planner.ts               # createPlan() + replan()
│       ├── executor.ts              # executeStep() с retryFeedback
│       └── validator.ts             # Двухфазная валидация
├── shared/
│   ├── types.ts                      # ActionLog, PlanStep, CompletedStep, StepError, ValidationDecision
│   ├── tools/
│   │   ├── schemas.ts               # OpenAI function calling schemas
│   │   ├── dispatcher.ts            # tool name → executor function
│   │   └── executor.ts              # Sandboxed tool implementations
│   └── reports/
│       ├── types.ts
│       └── store.ts
└── memory-bank/
    ├── loader.ts
    ├── common-errors.md
    └── vite-react-setup.md
```

---

## Статус реализации

- [x] graph.ts — граф с replanCount, feedback передачей, правильным роутингом
- [x] shared/types.ts — CompletedStep, StepError, расширенный PlanStep, ValidationDecision
- [x] planner.ts — промпт с targetFiles/stepType, replan принимает CompletedStep[], Zod-валидация LLM-ответа
- [x] executor.ts — параметр retryFeedback
- [x] validator.ts — двухфазная валидация (детерминированная + LLM)
- [x] main.ts — только single и multi (LangGraph), orchestrator удалён

## Запуск

```bash
npm run dev -- --arch multi "создай todo-приложение"
npm run dev -- --arch single "создай калькулятор"
```