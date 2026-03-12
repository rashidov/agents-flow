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
} from "../../shared/types.js";

// ── State ────────────────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  userRequest:      Annotation<string>,
  plan:             Annotation<PlanStep[]>,
  currentStepIndex: Annotation<number>,
  completedSteps:   Annotation<CompletedStep[]>,
  errors:           Annotation<StepError[]>,
  retryCount:       Annotation<number>,
  replanCount:      Annotation<number>,
  actions:          Annotation<ActionLog[]>,
  lastValidation:   Annotation<ValidationDecision>,
  status:           Annotation<"running" | "success" | "error">,
});

type State = typeof GraphState.State;

const MAX_RETRIES = 2;
const MAX_REPLANS = 2;

// ── Nodes ────────────────────────────────────────────────────────────────────

async function planNode(state: State): Promise<Partial<State>> {
  console.log("\n  [graph] Планирование...");
  const plan = await createPlan(state.userRequest);

  console.log(`  [graph] План: ${plan.length} шагов`);
  for (const [i, step] of plan.entries()) {
    console.log(`    ${i + 1}. [${step.stepType}] ${step.description}`);
    if (step.targetFiles.length) {
      console.log(`         → ${step.targetFiles.join(", ")}`);
    }
  }

  return {
    plan,
    currentStepIndex: 0,
    completedSteps: [],
    errors: [],
    retryCount: 0,
    replanCount: 0,
    actions: [],
    lastValidation: { action: "continue" },
    status: "running",
  };
}

async function executeNode(state: State): Promise<Partial<State>> {
  const step = state.plan[state.currentStepIndex]!;
  const retryLabel = state.retryCount > 0 ? ` (попытка ${state.retryCount + 1})` : "";

  console.log(`\n  [graph] Выполнение шага ${state.currentStepIndex + 1}/${state.plan.length}${retryLabel}...`);
  console.log(`         [${step.stepType}] ${step.description}`);

  // При retry передаём конкретный feedback от валидатора
  const retryFeedback =
    state.retryCount > 0 && state.lastValidation.action === "retry"
      ? state.lastValidation.feedback
      : undefined;

  // Снэпшот файлов ДО выполнения — для отслеживания созданных файлов
  const filesBefore = new Set(
    JSON.parse(listFiles() === "[]" ? "[]" : listFiles()) as string[]
  );

  const result = await executeStep(step, state.currentStepIndex, state.completedSteps, retryFeedback);

  // Файлы ПОСЛЕ выполнения — вычисляем diff
  const filesAfter = JSON.parse(listFiles() === "[]" ? "[]" : listFiles()) as string[];
  const filesCreated = filesAfter.filter((f) => !filesBefore.has(f));

  const newErrors: StepError[] = result.error
    ? [...state.errors, { stepIndex: state.currentStepIndex, description: step.description, error: result.error }]
    : state.errors;

  return {
    actions: [...state.actions, ...result.actions],
    errors: newErrors,
    // Временно сохраняем filesCreated в completedSteps только после validate
    // Здесь просто обновляем actions и errors
  };
}

async function validateNode(state: State): Promise<Partial<State>> {
  const step = state.plan[state.currentStepIndex]!;
  const stepStartAction = state.currentStepIndex * 100;
  const stepActions = state.actions.filter(
    (a) => a.step >= stepStartAction && a.step < stepStartAction + 100
  );
  const lastError = state.errors.find((e) => e.stepIndex === state.currentStepIndex);

  console.log(`  [graph] Валидация шага ${state.currentStepIndex + 1}...`);

  const decision = await validateStep(step, stepActions, lastError?.error);

  if (decision.action === "continue") {
    // Вычисляем какие файлы создал этот шаг
    const allFiles = JSON.parse(listFiles() === "[]" ? "[]" : listFiles()) as string[];
    const prevFiles = new Set(
      state.completedSteps.flatMap((s) => s.filesCreated)
    );
    const filesCreated = allFiles.filter((f) => !prevFiles.has(f));

    console.log(`  [graph] Шаг ${state.currentStepIndex + 1} — OK${filesCreated.length ? ` (создано: ${filesCreated.join(", ")})` : ""}`);

    return {
      completedSteps: [
        ...state.completedSteps,
        { description: step.description, filesCreated },
      ],
      currentStepIndex: state.currentStepIndex + 1,
      retryCount: 0,
      lastValidation: decision,
    };
  }

  if (decision.action === "retry") {
    console.log(`  [graph] Шаг ${state.currentStepIndex + 1} — повтор: ${decision.reason}`);
    return {
      retryCount: state.retryCount + 1,
      lastValidation: decision,
    };
  }

  // abort
  console.log(`  [graph] Шаг ${state.currentStepIndex + 1} — abort: ${decision.reason}`);
  return {
    errors: [
      ...state.errors,
      { stepIndex: state.currentStepIndex, description: step.description, error: decision.reason },
    ],
    lastValidation: decision,
  };
}

async function replanNode(state: State): Promise<Partial<State>> {
  console.log(`\n  [graph] Перепланирование #${state.replanCount + 1} с учётом ошибок...`);

  const newPlan = await replan(state.userRequest, state.completedSteps, state.errors);

  console.log(`  [graph] Новый план: ${newPlan.length} шагов`);
  for (const [i, step] of newPlan.entries()) {
    console.log(`    ${i + 1}. [${step.stepType}] ${step.description}`);
  }

  return {
    plan: newPlan,
    currentStepIndex: 0,
    retryCount: 0,
    replanCount: state.replanCount + 1,
    lastValidation: { action: "continue" },
  };
}

// ── Routing ──────────────────────────────────────────────────────────────────

function afterValidation(state: State): "execute" | "replan" | typeof END {
  if (state.lastValidation.action === "retry") {
    if (state.retryCount <= MAX_RETRIES) {
      return "execute";
    }
    console.log(`  [graph] Ретраи исчерпаны для шага ${state.currentStepIndex + 1}, перепланирование...`);
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
    .addNode("plan", planNode)
    .addNode("execute", executeNode)
    .addNode("validate", validateNode)
    .addNode("replan", replanNode)
    .addEdge(START, "plan")
    .addEdge("plan", "execute")
    .addEdge("execute", "validate")
    .addConditionalEdges("validate", afterValidation, ["execute", "replan", END])
    .addConditionalEdges("replan", afterReplan, ["execute", END]);

  return graph.compile();
}

// ── Public API ───────────────────────────────────────────────────────────────

async function run(userRequest: string): Promise<AgentResult> {
  const app = buildGraph();

  const finalState = await app.invoke({
    userRequest,
    plan:             [],
    currentStepIndex: 0,
    completedSteps:   [],
    errors:           [],
    retryCount:       0,
    replanCount:      0,
    actions:          [],
    lastValidation:   { action: "continue" },
    status:           "running",
  });

  const allDone = finalState.currentStepIndex >= finalState.plan.length;

  return {
    status: allDone ? "success" : "error",
    message: allDone
      ? `Проект создан за ${finalState.completedSteps.length} шагов`
      : `Остановлено на шаге ${finalState.currentStepIndex + 1}: ${finalState.errors.at(-1)?.error ?? "неизвестная ошибка"}`,
    actions: finalState.actions,
    steps: finalState.completedSteps.length,
  };
}

export const multiAgentGraph: Architecture = {
  name: "multi-agent-graph",
  run,
};
