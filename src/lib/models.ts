import type { ModelInfo } from "./api";

/** Parameter count in billions, from Ollama's "8.0B" or the tag ("llama3.2:3b"). */
export function paramsB(m: ModelInfo): number | null {
  const src = m.parameterSize ?? m.name.split(":")[1] ?? "";
  const match = src.match(/([\d.]+)\s*([bm])/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return match[2].toLowerCase() === "m" ? n / 1000 : n;
}

/**
 * Choose the model to use: the user's explicit choice if installed, otherwise an ~8B Llama,
 * otherwise the largest smaller Llama. Very large models (e.g. 70B) are only used when chosen.
 */
export function pickModel(models: ModelInfo[], preferred: string | null): string | null {
  const llamas = models.filter((m) => m.isLlama);
  if (preferred && llamas.some((m) => m.name === preferred)) return preferred;
  if (llamas.length === 0) return null;
  const score = (m: ModelInfo) => {
    const p = paramsB(m) ?? 5;
    if (p >= 7 && p <= 9) return 1000 + (m.name.startsWith("llama3.1") ? 1 : 0);
    if (p < 7) return 500 + p;
    return 100 - p;
  };
  return [...llamas].sort((a, b) => score(b) - score(a))[0].name;
}

export const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
