// ── Общие типы для всех архитектур ───────────────────────────────────────────

export interface ActionLog {
  step: number;
  tool: string;
  input: Record<string, string>;
  result: string;
  timestamp: string;
}

export interface AgentResult {
  status: "success" | "error";
  message: string;
  actions: ActionLog[];
  steps: number;
}

/** Шаг плана (используется в multi-agent) */
export interface PlanStep {
  description: string;
  expectedOutput: string;
  targetFiles: string[];
  stepType: "create-file" | "modify-file" | "run-command" | "multi";
  validationHints?: string[];
}

/** Выполненный шаг — хранит какие файлы были созданы */
export interface CompletedStep {
  description: string;
  filesCreated: string[];
}

/** Ошибка на конкретном шаге */
export interface StepError {
  stepIndex: number;
  description: string;
  error: string;
}

/** Решение валидатора */
export type ValidationDecision =
  | { action: "continue" }
  | { action: "retry"; reason: string; feedback: string }
  | { action: "abort"; reason: string };

/** Общий интерфейс для любой архитектуры */
export interface Architecture {
  name: string;
  run(userRequest: string): Promise<AgentResult>;
}