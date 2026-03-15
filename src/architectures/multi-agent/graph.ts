import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { createPlan, replan } from "./planner.js";
import { executeStep } from "./executor.js";
import { validateStep } from "./validator.js";
import { listFiles } from "../../shared/tools/executor.js";
import type {
  Architecture,
  AgentResult,
  ActionLog,
  PlanStep,
  CompletedStep,
  StepError,
  ValidationDecision,
  ExecutionEvent,
} from "../../shared/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function event(
  type: ExecutionEvent["type"],
  message: string,
  details?: Record<string, unknown>,
): ExecutionEvent {
  return { type, timestamp: new Date().toISOString(), message, details };
}

// ── State ────────────────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  userRequest: Annotation<string>,
  plan: Annotation<PlanStep[]>,
  currentStepIndex: Annotation<number>,
  completedSteps: Annotation<CompletedStep[]>,
  errors: Annotation<StepError[]>,
  retryCount: Annotation<number>,
  replanCount: Annotation<number>,
  actions: Annotation<ActionLog[]>,
  events: Annotation<ExecutionEvent[]>,
  lastValidation: Annotation<ValidationDecision>,
  status: Annotation<"running" | "success" | "error">,
});

type State = typeof GraphState.State;

const MAX_RETRIES = 2;
const MAX_REPLANS = 2;

// Рассчитывает минимально необходимый recursionLimit для плана.
// Можно передать фиксированное значение — оно будет использовано вместо расчёта.
function calcRecursionLimit(planLength: number, override?: number): number {
  if (override !== undefined) return override;
  // execute + validate на каждый шаг × (базовый прогон + все повторы)
  // + переходы на replan и повторный execute после него
  const perStep = 2 * (1 + MAX_RETRIES);
  const replanOverhead = MAX_REPLANS * (planLength * perStep + 2);
  return planLength * perStep + replanOverhead + 10;
}

// ── Nodes ────────────────────────────────────────────────────────────────────

async function planNode(state: State): Promise<Partial<State>> {
  console.log("\n  [graph] Планирование...");

  // Если план уже передан снаружи — не создаём повторно
  const plan =
    state.plan.length > 0 ? state.plan : await createPlan(state.userRequest);

  console.log(`  [graph] План: ${plan.length} шагов`);
  for (const [i, step] of plan.entries()) {
    console.log(`    ${i + 1}. [${step.stepType}] ${step.description}`);
    if (step.targetFiles.length) {
      console.log(`         → ${step.targetFiles.join(", ")}`);
    }
  }

  const planSummary = plan
    .map((s, i) => `${i + 1}. [${s.stepType}] ${s.description}`)
    .join("; ");

  return {
    plan,
    currentStepIndex: 0,
    completedSteps: [],
    errors: [],
    retryCount: 0,
    replanCount: 0,
    actions: [],
    events: [
      ...state.events,
      event("plan-created", `План создан: ${plan.length} шагов`, {
        summary: planSummary,
        stepsCount: plan.length,
      }),
    ],
    lastValidation: { action: "continue" },
    status: "running",
  };
}

async function executeNode(state: State): Promise<Partial<State>> {
  const step = state.plan[state.currentStepIndex]!;
  const retryLabel =
    state.retryCount > 0 ? ` (попытка ${state.retryCount + 1})` : "";

  console.log(
    `\n  [graph] Выполнение шага ${state.currentStepIndex + 1}/${state.plan.length}${retryLabel}...`,
  );
  console.log(`         [${step.stepType}] ${step.description}`);

  const stepMsg = `Шаг ${state.currentStepIndex + 1}/${state.plan.length}${retryLabel}: ${step.description}`;

  // При retry передаём конкретный feedback от валидатора
  const retryFeedback =
    state.retryCount > 0 && state.lastValidation.action === "retry"
      ? state.lastValidation.feedback
      : undefined;

  // Снэпшот файлов ДО выполнения — для отслеживания созданных файлов
  const filesBefore = new Set(
    JSON.parse(listFiles() === "[]" ? "[]" : listFiles()) as string[],
  );

  const result = await executeStep(
    step,
    state.currentStepIndex,
    state.completedSteps,
    retryFeedback,
  );

  // Файлы ПОСЛЕ выполнения — вычисляем diff
  const filesAfter = JSON.parse(
    listFiles() === "[]" ? "[]" : listFiles(),
  ) as string[];
  const filesCreated = filesAfter.filter((f) => !filesBefore.has(f));

  const newErrors: StepError[] = result.error
    ? [
        ...state.errors,
        {
          stepIndex: state.currentStepIndex,
          description: step.description,
          error: result.error,
        },
      ]
    : state.errors;

  const details: Record<string, unknown> = {
    stepType: step.stepType,
    toolCalls: result.actions.length,
    model: result.metrics.model,
    durationMs: result.metrics.durationMs,
    inputTokens: result.metrics.inputTokens,
    outputTokens: result.metrics.outputTokens,
  };
  if (filesCreated.length) details.filesCreated = filesCreated;
  if (result.error) details.error = result.error;

  return {
    actions: [...state.actions, ...result.actions],
    errors: newErrors,
    events: [...state.events, event("step-start", stepMsg, details)],
  };
}

async function validateNode(state: State): Promise<Partial<State>> {
  const step = state.plan[state.currentStepIndex]!;
  const stepStartAction = state.currentStepIndex * 100;
  const stepActions = state.actions.filter(
    (a) => a.step >= stepStartAction && a.step < stepStartAction + 100,
  );
  const lastError = state.errors.find(
    (e) => e.stepIndex === state.currentStepIndex,
  );

  console.log(`  [graph] Валидация шага ${state.currentStepIndex + 1}...`);

  const decision = await validateStep(step, stepActions, lastError?.error);

  if (decision.action === "continue") {
    // Вычисляем какие файлы создал этот шаг
    const allFiles = JSON.parse(
      listFiles() === "[]" ? "[]" : listFiles(),
    ) as string[];
    const prevFiles = new Set(
      state.completedSteps.flatMap((s) => s.filesCreated),
    );
    const filesCreated = allFiles.filter((f) => !prevFiles.has(f));

    console.log(
      `  [graph] Шаг ${state.currentStepIndex + 1} — OK${filesCreated.length ? ` (создано: ${filesCreated.join(", ")})` : ""}`,
    );

    return {
      completedSteps: [
        ...state.completedSteps,
        { description: step.description, filesCreated },
      ],
      currentStepIndex: state.currentStepIndex + 1,
      retryCount: 0,
      lastValidation: decision,
      events: [
        ...state.events,
        event(
          "step-ok",
          `Шаг ${state.currentStepIndex + 1} — OK: ${step.description}`,
          {
            filesCreated: filesCreated.length ? filesCreated : undefined,
          },
        ),
      ],
    };
  }

  if (decision.action === "retry") {
    console.log(
      `  [graph] Шаг ${state.currentStepIndex + 1} — повтор: ${decision.reason}`,
    );
    return {
      retryCount: state.retryCount + 1,
      lastValidation: decision,
      events: [
        ...state.events,
        event(
          "step-retry",
          `Шаг ${state.currentStepIndex + 1} — повтор: ${decision.reason}`,
          {
            reason: decision.reason,
            feedback: decision.feedback,
            attempt: state.retryCount + 1,
          },
        ),
      ],
    };
  }

  // abort
  console.log(
    `  [graph] Шаг ${state.currentStepIndex + 1} — abort: ${decision.reason}`,
  );
  return {
    errors: [
      ...state.errors,
      {
        stepIndex: state.currentStepIndex,
        description: step.description,
        error: decision.reason,
      },
    ],
    lastValidation: decision,
    events: [
      ...state.events,
      event(
        "step-abort",
        `Шаг ${state.currentStepIndex + 1} — прерван: ${decision.reason}`,
        {
          reason: decision.reason,
        },
      ),
    ],
  };
}

async function replanNode(state: State): Promise<Partial<State>> {
  console.log(
    `\n  [graph] Перепланирование #${state.replanCount + 1} с учётом ошибок...`,
  );

  const errorsSummary = state.errors
    .map((e) => `${e.description}: ${e.error}`)
    .join("; ");

  const newPlan = await replan(
    state.userRequest,
    state.completedSteps,
    state.errors,
  );

  console.log(`  [graph] Новый план: ${newPlan.length} шагов`);
  for (const [i, step] of newPlan.entries()) {
    console.log(`    ${i + 1}. [${step.stepType}] ${step.description}`);
  }

  const newPlanSummary = newPlan
    .map((s, i) => `${i + 1}. [${s.stepType}] ${s.description}`)
    .join("; ");

  return {
    plan: newPlan,
    currentStepIndex: 0,
    retryCount: 0,
    replanCount: state.replanCount + 1,
    lastValidation: { action: "continue" },
    events: [
      ...state.events,
      event(
        "replan",
        `Перепланирование #${state.replanCount + 1}: ${newPlan.length} шагов`,
        {
          причина: errorsSummary,
          новыйПлан: newPlanSummary,
          stepsCount: newPlan.length,
        },
      ),
    ],
  };
}

// ── Routing ──────────────────────────────────────────────────────────────────

function afterValidation(state: State): "execute" | "replan" | typeof END {
  if (state.lastValidation.action === "retry") {
    if (state.retryCount <= MAX_RETRIES) {
      return "execute";
    }
    console.log(
      `  [graph] Ретраи исчерпаны для шага ${state.currentStepIndex + 1}, перепланирование...`,
    );
    return "replan";
  }

  if (state.lastValidation.action === "abort") {
    return "replan";
  }

  // continue
  if (state.currentStepIndex >= state.plan.length) {
    return END;
  }

  return "execute";
}

function afterReplan(state: State): "execute" | typeof END {
  if (state.plan.length === 0 || state.replanCount > MAX_REPLANS) {
    console.log("  [graph] Перепланирование не помогло, завершение.");
    return END;
  }
  return "execute";
}

// ── Graph ────────────────────────────────────────────────────────────────────

function buildGraph() {
  const graph = new StateGraph(GraphState)
    .addNode("planner", planNode)
    .addNode("execute", executeNode)
    .addNode("validate", validateNode)
    .addNode("replan", replanNode)
    .addEdge(START, "planner")
    .addEdge("planner", "execute")
    .addEdge("execute", "validate")
    .addConditionalEdges("validate", afterValidation, [
      "execute",
      "replan",
      END,
    ])
    .addConditionalEdges("replan", afterReplan, ["execute", END]);

  return graph.compile();
}

// ── Public API ───────────────────────────────────────────────────────────────

async function run(userRequest: string): Promise<AgentResult> {
  const app = buildGraph();

  // Создаём план заранее, чтобы рассчитать точный recursionLimit.
  // Fallback: если планировщик вернёт пустой план — используем оценку в 30 шагов.
  console.log("\n📋 Планирование...");
  const initialPlan = await createPlan(userRequest);

  console.log(`\n📋 План готов (${initialPlan.length} шагов):`);
  for (const [i, step] of initialPlan.entries()) {
    console.log(`  ${i + 1}. [${step.stepType}] ${step.description}`);
    if (step.targetFiles.length) {
      console.log(`     → ${step.targetFiles.join(", ")}`);
    }
  }
  console.log();
  const recursionLimit = calcRecursionLimit(
    initialPlan.length > 0 ? initialPlan.length : 30,
    130,
  );

  const initialState: State = {
    userRequest,
    plan: initialPlan,
    currentStepIndex: 0,
    completedSteps: [],
    errors: [],
    retryCount: 0,
    replanCount: 0,
    actions: [],
    events: [],
    lastValidation: { action: "continue" },
    status: "running",
  };

  // Стримим граф, чтобы при ошибке (например recursion limit)
  // сохранить всё накопленное состояние в отчёт.
  let lastState: State = { ...initialState };

  try {
    const stream = await app.stream(initialState, { recursionLimit });
    for await (const chunk of stream) {
      // chunk = { [nodeName]: nodeOutput }
      const nodeOutput = Object.values(chunk)[0] as Partial<State> | undefined;
      if (nodeOutput) {
        lastState = { ...lastState, ...nodeOutput };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [graph] Ошибка графа: ${message}`);

    lastState.events = [
      ...lastState.events,
      event("error", `Ошибка графа: ${message}`),
    ];
    lastState.status = "error";
  }

  const allDone =
    lastState.status !== "error" &&
    lastState.currentStepIndex >= lastState.plan.length;

  return {
    status: allDone ? "success" : "error",
    message: allDone
      ? `Проект создан за ${lastState.completedSteps.length} шагов`
      : `Остановлено на шаге ${lastState.currentStepIndex + 1}: ${lastState.errors.at(-1)?.error ?? "неизвестная ошибка"}`,
    actions: lastState.actions,
    steps: lastState.completedSteps.length,
    events: lastState.events,
    plan: initialPlan,
  };
}

export const multiAgentGraph: Architecture = {
  name: "multi-agent-graph",
  run,
};
