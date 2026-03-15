import "dotenv/config";
import { singleAgent } from "./architectures/single-agent/agent.js";
import { multiAgentGraph } from "./architectures/multi-agent/graph.js";
import { saveReport, printReport } from "./shared/reports/store.js";
import type { Architecture } from "./shared/types.js";

// ── Реестр архитектур ────────────────────────────────────────────────────────

const ARCHITECTURES: Record<string, Architecture> = {
  single: singleAgent,
  multi: multiAgentGraph,
};

// ── CLI ──────────────────────────────────────────────────────────────────────
// Использование:
//   npm run dev -- --arch single "создай todo-приложение"
//   npm run dev -- --arch multi  "создай калькулятор"  (LangGraph)

function parseArgs() {
  const args = process.argv.slice(2);

  let arch = "single";
  let request = "создай простое todo-приложение с возможностью добавлять и удалять задачи";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--arch" && args[i + 1]) {
      arch = args[i + 1]!;
      i++;
    } else if (!args[i]!.startsWith("--")) {
      request = args[i]!;
    }
  }

  return { arch, request };
}

async function main() {
  const { arch, request } = parseArgs();

  const architecture = ARCHITECTURES[arch];
  if (!architecture) {
    console.error(`Неизвестная архитектура: ${arch}`);
    console.error(`Доступные: ${Object.keys(ARCHITECTURES).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n  Архитектура: ${architecture.name}`);
  console.log(`  Запрос:      ${request}\n`);

  const startTime = Date.now();

  try {
    const result = await architecture.run(request);
    const durationMs = Date.now() - startTime;
    const report = saveReport(architecture.name, request, result, durationMs);
    printReport(report);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    console.error("Ошибка:", message);
    const report = saveReport(architecture.name, request, {
      status: "error",
      message: `Критическая ошибка: ${message}`,
      actions: [],
      steps: 0,
    }, durationMs);
    printReport(report);
    process.exit(1);
  }
}

main();
