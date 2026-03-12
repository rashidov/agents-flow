import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Загрузчик базы знаний ────────────────────────────────────────────────────
// Читает все .md файлы из memory-bank/ и склеивает в один текст.
// Этот текст инжектируется в system prompt планировщика.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadMemoryBank(): string {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".md"));

  if (files.length === 0) return "(база знаний пуста)";

  return files
    .map((file) => {
      const content = fs.readFileSync(path.join(__dirname, file), "utf-8");
      return `--- ${file} ---\n${content}`;
    })
    .join("\n\n");
}
