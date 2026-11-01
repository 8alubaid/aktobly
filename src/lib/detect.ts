// Lightweight script-based language detection for Arabic / English / mixed text.

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

export type Detected = "ar" | "en" | "mixed" | "none";

export function arabicRatio(text: string): number {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  return ar + en === 0 ? 0 : ar / (ar + en);
}

export function detectLanguage(text: string): Detected {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  if (ar + en === 0) return "none";
  const ratio = ar / (ar + en);
  if (ratio >= 0.8) return "ar";
  if (ratio <= 0.2) return "en";
  return "mixed";
}

/** Text direction for display: RTL when Arabic letters dominate. */
export function directionOf(text: string): "rtl" | "ltr" {
  return arabicRatio(text) > 0.5 ? "rtl" : "ltr";
}

export const DETECTED_LABEL: Record<Detected, string> = {
  ar: "Arabic",
  en: "English",
  mixed: "Arabic + English",
  none: "",
};
