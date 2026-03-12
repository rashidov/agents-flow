import fs from "node:fs";
import path from "node:path";
import type { AgentResult } from "../types.js";
import type { Report } from "./types.js";

const REPORTS_DIR = path.resolve("./reports");

function ensureDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

export function saveReport(
  architecture: string,
  request: string,
  result: AgentResult,
  durationMs: number
): Report {
  ensureDir();

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const report: Report = {
    id,
    architecture,
    timestamp: new Date().toISOString(),
    request,
    status: result.status,
    steps: result.steps,
    durationMs,
    message: result.message,
    actions: result.actions,
  };

  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");

  return report;
}

export function getReport(id: string): Report | null {
  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Report;
}

export function listReports(): Report[] {
  ensureDir();
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = fs.readFileSync(path.join(REPORTS_DIR, f), "utf-8");
      return JSON.parse(content) as Report;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function printReport(report: Report): void {
  const duration = (report.durationMs / 1000).toFixed(1);
  console.log("\n─────────────────────────────────────────");
  console.log(`  Отчёт:        ${report.id}`);
  console.log(`  Архитектура:  ${report.architecture}`);
  console.log(`  Время:        ${report.timestamp}`);
  console.log(`  Запрос:       ${report.request}`);
  console.log(`  Статус:       ${report.status}`);
  console.log(`  Шагов:        ${report.steps}`);
  console.log(`  Длительность: ${duration}s`);
  console.log("\n  Действия агента:");
  for (const action of report.actions) {
    console.log(`    [${action.step}] ${action.tool}`);
    console.log(`         -> ${action.result.split("\n")[0]}`);
  }
  console.log("\n  Финальный ответ:");
  console.log(`  ${report.message.slice(0, 500)}`);
  console.log("─────────────────────────────────────────\n");
}
