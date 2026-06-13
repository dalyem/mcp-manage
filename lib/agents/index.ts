import fs from "node:fs";
import path from "node:path";
import type { AgentKey } from "../types";
import type { AgentAdapter } from "./adapter";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { geminiAdapter } from "./gemini";
import { opencodeAdapter } from "./opencode";

export const ADAPTERS: Record<AgentKey, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
};

export const ADAPTER_LIST: AgentAdapter[] = Object.values(ADAPTERS);

export function getAdapter(key: AgentKey): AgentAdapter {
  return ADAPTERS[key];
}

/** Is any of these binaries resolvable on PATH? (pure fs, no shell spawn) */
export function anyBinaryOnPath(binaries: string[]): boolean {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const bin of binaries) {
    for (const dir of dirs) {
      const full = path.join(dir, bin);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return true;
      } catch {
        // keep looking
      }
    }
  }
  return false;
}

export type { AgentAdapter } from "./adapter";
