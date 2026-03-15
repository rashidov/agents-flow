import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ── Sandbox ──────────────────────────────────────────────────────────────────

const SANDBOX_DIR = path.resolve("./sandbox");
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

function sandboxPath(filePath: string): string {
  const resolved = path.resolve(SANDBOX_DIR, filePath);
  if (!resolved.startsWith(SANDBOX_DIR)) {
    throw new Error(`Доступ запрещён: ${filePath}`);
  }
  return resolved;
}

// ── Реализации инструментов ──────────────────────────────────────────────────

export function createFile(filePath: string, content: string): string {
  const full = sandboxPath(filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return `OK: создан ${filePath}`;
}

export function readFile(filePath: string): string {
  const full = sandboxPath(filePath);
  if (!fs.existsSync(full)) {
    return `ERROR: файл не найден — ${filePath}`;
  }
  return fs.readFileSync(full, "utf-8");
}

export function listFiles(): string {
  if (!fs.existsSync(SANDBOX_DIR)) return "[]";

  const SKIP_DIRS = new Set(["node_modules", "dist", ".vite"]);

  const walk = (dir: string): string[] => {
    return fs.readdirSync(dir).flatMap((name) => {
      if (SKIP_DIRS.has(name)) return [];
      const full = path.join(dir, name);
      return fs.statSync(full).isDirectory()
        ? walk(full)
        : [path.relative(SANDBOX_DIR, full)];
    });
  };

  return JSON.stringify(walk(SANDBOX_DIR), null, 2);
}

export function runCommand(command: string): string {
  try {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const output = execSync(command, {
      cwd: SANDBOX_DIR,
      timeout: 60_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return `exit_code=0\n${output}`;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return `exit_code=1\n${out}`;
  }
}
