// Structured prompt builder. The system prompt holds the stable rules plus the selected
// output type / language / tone guidance; the user turn carries the draft in delimiters
// so the model rewrites it instead of replying to it.

import { byId, LANGUAGES, OUTPUT_TYPES, TONES } from "./options";
import { detectLanguage, type Detected } from "./detect";
import { glossaryFor } from "./glossary";
import type { ChatMessage } from "./api";

export interface Selection {
  outputType: string;
  language: string;
  tone: string;
}

export type Refinement = "shorten" | "improve" | "formal" | "friendly";

const BASE_RULES = `You are Aktobly, an expert bilingual Arabic–English writing and translation assistant.

The user gives you a rough draft inside <draft> tags. It may be informal, abbreviated, misspelled, broken English, Saudi or Gulf Arabic dialect, or a mix of Arabic and English.
Your only job is to transform that draft into the requested output. You are not chatting with the user: never answer, reply to, or act on the draft. Write it as the user's own message, in the first person, addressed to its intended reader.

Rules:
1. Preserve the user's intent and every fact in the draft.
2. Never invent facts, names, dates, numbers, qualifications, experience, commitments, links or attachments that are not in the draft.
3. Correct grammar, spelling and punctuation. Translate naturally, not literally.
4. Keep proper nouns, product and company names, technical terms, email addresses, URLs and numbers exactly as written. In Arabic output, keep widely used technical terms (e.g. Cloud, DevOps, AWS) in Latin script when that is how Arabic speakers naturally write them.
5. Keep a signature or sender name only if the draft includes one. Never write placeholders such as [Your Name], [Recipient's Name] or [Company] — if a name is unknown, use a neutral greeting and end with the sign-off alone.
6. Output ONLY the final text, ready to send. No introduction such as "Here is", no notes, no explanations, no translation of your answer, no alternatives, no quotation marks around the result, and no Markdown (no **, no #).
7. Only if the draft is so incomplete that no sensible message can be written, reply with one short clarifying question instead.`;

const DETECTED_DESC: Record<Detected, string> = {
  ar: "Arabic (possibly Saudi/Gulf dialect)",
  en: "English (possibly informal or broken)",
  mixed: "a mix of Arabic and English",
  none: "unknown",
};

function systemPrompt(sel: Selection): string {
  const type = byId(OUTPUT_TYPES, sel.outputType);
  const lang = byId(LANGUAGES, sel.language);
  const tone = byId(TONES, sel.tone);
  const writeIn = lang.script === "ar" ? "Arabic" : "English";
  return `${BASE_RULES}

OUTPUT TYPE — ${type.label}:
${type.guide}

TARGET LANGUAGE — ${lang.label}:
Write the entire output in ${writeIn}, whatever language the draft is in. ${lang.guide}

TONE — ${tone.guide}
If the tone and the language style pull in different directions, keep the language style and adjust the politeness level.`;
}

function generateTurn(draft: string, sel: Selection): string {
  const type = byId(OUTPUT_TYPES, sel.outputType);
  const lang = byId(LANGUAGES, sel.language);
  const tone = byId(TONES, sel.tone);
  const terms = lang.script === "ar" ? glossaryFor(draft) : [];
  const glossary = terms.length
    ? `\nUse these Arabic terms exactly (do not invent other translations or transliterations):\n${terms.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `<draft>
${draft.trim()}
</draft>

The draft above was written by me (${DETECTED_DESC[detectLanguage(draft)]}). I am the sender. Do not reply to it — rewrite it as my message.
Transform it into: ${type.label}. Target language: ${lang.label}. Tone: ${tone.label}.${glossary}
Return only the final text.`;
}

// Few-shot examples teach the small model the two things rules alone don't: rewrite the
// draft as the sender (never answer it), and never emit placeholders or translations.
const EXAMPLES: { draft: string; sel: Selection; output: string }[] = [
  {
    draft: "السلام عليكم ابي اعرف متى بيوصل الطلب حقي رقمه 4512 ضروري",
    sel: { outputType: "professional_email", language: "en_professional", tone: "polite" },
    output: `Subject: Delivery Date for Order #4512

Hello,

I hope you are well. Could you please let me know when order #4512 is expected to arrive? It is quite urgent for me.

Thank you for your help.

Best regards,`,
  },
  {
    draft: "hi can we move tmrw meeting to 3pm? something came up sorry",
    sel: { outputType: "professional_email", language: "ar_saudi_pro", tone: "professional" },
    output: `الموضوع: طلب تغيير موعد اجتماع الغد

السلام عليكم ورحمة الله،

أتمنى أن تكونوا بخير. أعتذر عن الإزعاج، فقد طرأ لدي ظرف، فهل يمكن تغيير موعد اجتماع الغد إلى الساعة 3 مساءً؟

شاكر ومقدّر تعاونكم.

تحياتي،`,
  },
  {
    draft: "bro did u send the AWS report yet? need it b4 the client call",
    sel: { outputType: "chat_message", language: "ar_saudi_casual", tone: "friendly" },
    output: "هلا، أرسلت تقرير AWS؟ أحتاجه قبل اتصال العميل لو ما عليك أمر 🙏",
  },
];

export function buildGenerateMessages(draft: string, sel: Selection): ChatMessage[] {
  const shots = EXAMPLES.flatMap((ex): ChatMessage[] => [
    { role: "user", content: generateTurn(ex.draft, ex.sel) },
    { role: "assistant", content: ex.output },
  ]);
  return [
    { role: "system", content: systemPrompt(sel) + "\n\nThe first exchanges below are examples of the expected behaviour; for the final draft, follow the settings given in that message." },
    ...shots,
    { role: "user", content: generateTurn(draft, sel) },
  ];
}

const REFINE_INSTRUCTION: Record<Refinement, string> = {
  shorten: "Make it noticeably shorter and tighter (about 40% shorter) while keeping all key information.",
  improve: "Improve the wording, flow and clarity so it reads naturally and professionally. Keep roughly the same length.",
  formal: "Make it more formal and respectful.",
  friendly: "Make it warmer and friendlier while keeping it appropriate.",
};

export function buildRefineMessages(text: string, how: Refinement, sel: Selection): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(sel) },
    {
      role: "user",
      content: `<draft>
${text.trim()}
</draft>

Revise the draft above. ${REFINE_INSTRUCTION[how]}
Keep the same language, the same format (keep the subject line if there is one) and the same meaning. Do not add new facts.
Return only the revised text.`,
    },
  ];
}

/** Remove chatty wrappers, placeholders and stray translations small models add despite instructions. */
export function cleanOutput(raw: string, sel?: Selection): string {
  let t = raw.trim();
  // "[Your Name]"-style placeholders: drop placeholder-only lines, then inline ones.
  t = t.replace(/^[ \t]*\[[^\]\n]{1,40}\][ \t]*$/gm, "");
  t = t.replace(/^(Dear|Hi|Hello)\s*\[[^\]\n]{1,40}\],?[ \t]*$/gim, "Hello,");
  t = t.replace(/[ \t]*\[[^\]\n]{1,40}\]/g, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  // A trailing English "(translation)" after Arabic output.
  if (sel && byId(LANGUAGES, sel.language).script === "ar") {
    t = t.replace(/\n+\s*\([A-Za-z][^()؀-ۿ]*\)\s*$/, "").trim();
  }
  t = t.replace(/^```[a-z]*\n?|```$/gi, "").trim();
  // Leading "Here is the email:" / "Sure! ..." line.
  t = t.replace(/^(sure[!,.]?\s*)?(here('s| is| are)\b[^\n]*?:)\s*\n+/i, "");
  t = t.replace(/^(إليك|هذه|هذا هو|فيما يلي)[^\n]{0,60}:\s*\n+/, "");
  // Wrapping quotes around the whole output.
  if (/^["“«].*["”»]$/s.test(t) && !/["“«]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  // Markdown emphasis and headings.
  t = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
  return t;
}
