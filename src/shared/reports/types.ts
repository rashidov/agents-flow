import type { ActionLog, ExecutionEvent, PlanStep } from "../types.js";

export interface Report {
  id: string;
  architecture: string;
  timestamp: string;
  request: string;
  status: "success" | "error";
  steps: number;
  durationMs: number;
  message: string;
  actions: ActionLog[];
  /** Лог событий: планирование, валидация, ретраи, реплан */
  events: ExecutionEvent[];
  /** Изначальный план */
  plan: PlanStep[];
}
