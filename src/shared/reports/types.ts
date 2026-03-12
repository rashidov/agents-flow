import type { ActionLog } from "../types.js";

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
}
