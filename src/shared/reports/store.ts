import fs from "node:fs";
import path from "node:path";
import type { AgentResult } from "../types.js";
import type { Report } from "./types.js";

const REPORTS_DIR = path.resolve("./reports");

function ensureDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// ── Markdown ────────────────────────────────────────────────────────────────

export function generateMarkdown(report: Report): string {
  const duration = (report.durationMs / 1000).toFixed(1);
  const statusEmoji = report.status === "success" ? "✅" : "❌";
  const date = new Date(report.timestamp).toLocaleString("ru-RU", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const lines: string[] = [];

  // ── Шапка ──────────────────────────────────────────────────────────────────
  lines.push(`# Отчёт агента`);
  lines.push(``);
  lines.push(`| Поле | Значение |`);
  lines.push(`|------|----------|`);
  lines.push(`| **ID** | \`${report.id}\` |`);
  lines.push(`| **Архитектура** | ${report.architecture} |`);
  lines.push(`| **Время** | ${date} UTC |`);
  lines.push(`| **Запрос** | ${report.request} |`);
  lines.push(`| **Статус** | ${statusEmoji} ${report.status} |`);
  lines.push(`| **Шагов завершено** | ${report.steps} |`);
  lines.push(`| **Длительность** | ${duration}s |`);
  lines.push(``);

  // ── План ───────────────────────────────────────────────────────────────────
  if (report.plan.length > 0) {
    lines.push(`## План`);
    lines.push(``);
    for (const [i, step] of report.plan.entries()) {
      const files = step.targetFiles.length
        ? ` → ${step.targetFiles.join(", ")}`
        : "";
      lines.push(`${i + 1}. **[${step.stepType}]** ${step.description}${files}`);
    }
    lines.push(``);
  }

  // ── Ход выполнения ─────────────────────────────────────────────────────────
  if (report.events.length > 0) {
    lines.push(`## Ход выполнения`);
    lines.push(``);

    for (const event of report.events) {
      const time = new Date(event.timestamp).toLocaleTimeString("ru-RU", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const icon = eventIcon(event.type);
      lines.push(`- \`${time}\` ${icon} ${event.message}`);

      if (event.details) {
        const d = event.details;
        // Метрики шага — компактная строка
        if (d.model) {
          const dur = typeof d.durationMs === "number" ? `${(d.durationMs / 1000).toFixed(1)}s` : "?";
          const tokens = typeof d.inputTokens === "number" && typeof d.outputTokens === "number"
            ? `${d.inputTokens}+${d.outputTokens} tok`
            : "";
          lines.push(`  - **модель:** ${d.model} | **время:** ${dur} | **токены:** ${tokens}`);
        }
        const skipKeys = new Set(["model", "durationMs", "inputTokens", "outputTokens"]);
        const detailEntries = Object.entries(d).filter(([k]) => !skipKeys.has(k));
        for (const [key, value] of detailEntries) {
          if (Array.isArray(value) && value.length > 0) {
            lines.push(`  - **${key}:** ${value.join(", ")}`);
          } else if (typeof value === "string" && value.length > 0) {
            lines.push(`  - **${key}:** ${value}`);
          } else if (typeof value === "number") {
            lines.push(`  - **${key}:** ${value}`);
          }
        }
      }
    }
    lines.push(``);
  }

  // ── Итог ───────────────────────────────────────────────────────────────────
  lines.push(`## Итог`);
  lines.push(``);
  lines.push(report.message);
  lines.push(``);

  // ── Действия агента ────────────────────────────────────────────────────────
  lines.push(`## Действия агента`);
  lines.push(``);

  let currentStep = -1;
  for (const action of report.actions) {
    if (action.step !== currentStep) {
      currentStep = action.step;
      lines.push(`### Шаг ${action.step}`);
      lines.push(``);
    }

    const inputStr = JSON.stringify(action.input ?? {}, null, 2);
    const resultFirstLine = action.result.split("\n")[0];
    const resultFull =
      action.result.length > 300
        ? action.result.slice(0, 300) + "\n..."
        : action.result;

    lines.push(`**Инструмент:** \`${action.tool}\``);
    lines.push(``);
    lines.push(`<details>`);
    lines.push(`<summary>Входные данные</summary>`);
    lines.push(``);
    lines.push("```json");
    lines.push(inputStr);
    lines.push("```");
    lines.push(``);
    lines.push(`</details>`);
    lines.push(``);
    lines.push(`**Результат:** ${resultFirstLine}`);
    if (action.result.includes("\n")) {
      lines.push(``);
      lines.push("```");
      lines.push(resultFull);
      lines.push("```");
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function eventIcon(type: string): string {
  switch (type) {
    case "plan-created": return "📋";
    case "step-start":   return "▶️";
    case "step-ok":      return "✅";
    case "step-retry":   return "🔄";
    case "step-abort":   return "⛔";
    case "replan":       return "📝";
    case "error":        return "❌";
    default:             return "•";
  }
}

// ── Сохранение ──────────────────────────────────────────────────────────────

export function saveReport(
  architecture: string,
  request: string,
  result: AgentResult,
  durationMs: number,
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
    events: result.events ?? [],
    plan: result.plan ?? [],
  };

  const jsonPath = path.join(REPORTS_DIR, `${id}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const mdPath = path.join(REPORTS_DIR, `${id}.md`);
  fs.writeFileSync(mdPath, generateMarkdown(report), "utf-8");

  return report;
}

// ── Чтение ──────────────────────────────────────────────────────────────────

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

// ── Печать в консоль ────────────────────────────────────────────────────────

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

  if (report.events.length > 0) {
    console.log("\n  Ход выполнения:");
    for (const event of report.events) {
      const icon = eventIcon(event.type);
      const d = event.details;
      const metricsStr = d?.model
        ? ` [${d.model} | ${typeof d.durationMs === "number" ? (d.durationMs / 1000).toFixed(1) + "s" : "?"} | ${d.inputTokens}+${d.outputTokens} tok]`
        : "";
      console.log(`    ${icon} ${event.message}${metricsStr}`);
    }
  }

  console.log("\n  Действия агента:");
  for (const action of report.actions) {
    console.log(`    [${action.step}] ${action.tool}`);
    console.log(`         -> ${action.result.split("\n")[0]}`);
  }
  console.log("\n  Финальный ответ:");
  console.log(`  ${report.message.slice(0, 500)}`);
  console.log("─────────────────────────────────────────\n");
}