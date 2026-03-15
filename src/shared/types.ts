// ── Общие типы для всех архитектур ───────────────────────────────────────────

export interface ActionLog {
  step: number;
  tool: string;
  input: Record<string, string>;
  result: string;
  timestamp: string;
}

/** Событие хода выполнения (для подробных отчётов) */
export interface ExecutionEvent {
  type:
    | "plan-created"
    | "step-start"
    | "step-ok"
    | "step-retry"
    | "step-abort"
    | "replan"
    | "error";
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AgentResult {
  status: "success" | "error";
  message: string;
  actions: ActionLog[];
  steps: number;
  /** Лог событий: планирование, валидация, ретраи, реплан */
  events?: ExecutionEvent[];
  /** Изначальный план */
  plan?: PlanStep[];
}

/** Шаг плана (используется в multi-agent) */
export interface PlanStep {
  description: string;
  expectedOutput: string;
  targetFiles: string[];
  stepType: "create-file" | "modify-file" | "run-command" | "multi";
  /** Сложность шага: low → Haiku, high → Sonnet */
  complexity: "low" | "high";
  /** Какие файлы из memory-bank передать executor'у (например ["vite-react-setup.md"]) */
  memoryKeys: string[];
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