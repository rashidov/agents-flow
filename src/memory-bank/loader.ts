import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Загрузчик базы знаний ────────────────────────────────────────────────────
// Читает все .md файлы из memory-bank/ и склеивает в один текст.
// Этот текст инжектируется в system prompt планировщика.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MemoryKeyInfo {
  name: string;
  description: string;
}

function getMdFiles(): string[] {
  return fs.readdirSync(__dirname).filter((f) => f.endsWith(".md"));
}

/** Извлекает описание из первой строки `# заголовок` md-файла */
function extractDescription(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const firstLine = content.split("\n")[0] ?? "";
  return firstLine.replace(/^#\s*/, "").trim() || "(без описания)";
}

/** Полный дамп всех md-файлов (для планировщика) */
export function loadMemoryBank(): string {
  const files = getMdFiles();

  if (files.length === 0) return "(база знаний пуста)";

  return files
    .map((file) => {
      const content = fs.readFileSync(path.join(__dirname, file), "utf-8");
      return `--- ${file} ---\n${content}`;
    })
    .join("\n\n");
}

/** Каталог файлов memory-bank: имя + описание (для промпта планировщика) */
export function listMemoryKeys(): MemoryKeyInfo[] {
  return getMdFiles().map((file) => ({
    name: file,
    description: extractDescription(path.join(__dirname, file)),
  }));
}

/** Загрузить только указанные файлы memory-bank (для executor'а) */
export function loadMemoryFiles(keys: string[]): string {
  if (keys.length === 0) return "";

  const existing = new Set(getMdFiles());

  return keys
    .filter((k) => existing.has(k))
    .map((file) => {
      const content = fs.readFileSync(path.join(__dirname, file), "utf-8");
      return `--- ${file} ---\n${content}`;
    })
    .join("\n\n");
}
