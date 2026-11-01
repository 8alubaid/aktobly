// Output types, target languages and tones, with the prompt guidance each one contributes.
// Keep labels short: they appear in compact dropdowns.

export interface Option {
  id: string;
  label: string;
  guide: string;
}

export interface LanguageOption extends Option {
  script: "ar" | "en";
  /** Counterpart used by the swap action. */
  swap: string;
}

export const OUTPUT_TYPES: Option[] = [
  {
    id: "professional_email",
    label: "Professional Email",
    guide: `A complete professional email.
- Line 1: a specific subject line, written as "Subject: ..." in English or "الموضوع: ..." in Arabic.
- Then a blank line, a greeting, a concise body in short paragraphs, a brief closing line, and a sign-off (e.g. "Best regards," / "مع خالص التحية،").
- Do not add a sender name, title or contact details unless the draft provides them. Never use placeholders like [Your Name].`,
  },
  {
    id: "casual_email",
    label: "Casual Email",
    guide: `A relaxed, friendly email.
- Line 1: a short subject line ("Subject: ..." / "الموضوع: ...").
- Then a blank line, an informal greeting (e.g. "Hi," / "هلا،"), a short natural body, and a light sign-off (e.g. "Thanks!" / "شكراً لك").
- No sender name unless the draft provides one. No placeholders.`,
  },
  {
    id: "chat_message",
    label: "WhatsApp / Chat",
    guide: `A chat message for WhatsApp, Slack or Teams.
- No subject line, no "Dear", no email structure, no formal sign-off.
- One to three short sentences that read naturally in a chat.
- At most one emoji, and only for friendly or casual tones.`,
  },
  {
    id: "formal_letter",
    label: "Formal Letter",
    guide: `A formal letter.
- A formal salutation (e.g. "Dear Sir or Madam," / "السلام عليكم ورحمة الله وبركاته،"), an opening sentence stating the purpose, a well-organised body, and a formal closing (e.g. "Yours faithfully," / "وتفضلوا بقبول فائق الاحترام والتقدير،").
- Do not invent dates, addresses, reference numbers or names.`,
  },
  {
    id: "translation",
    label: "Plain Translation",
    guide: `A faithful translation into the target language.
- Preserve the meaning, structure and approximate length of the draft. Translate naturally, not word-for-word.
- Fix only obvious typos. Do NOT add a greeting, subject line, sign-off, or any content that is not in the draft.
- Apply the tone only lightly through word choice.`,
  },
  {
    id: "grammar",
    label: "Grammar Correction",
    guide: `A corrected version of the draft.
- Fix spelling, grammar and punctuation only. Keep the original wording, structure and style as close as possible.
- If the target language differs from the draft's language, translate it with the same minimal-change approach.
- Do not add greetings, subject lines or new sentences.`,
  },
  {
    id: "rewrite",
    label: "Professional Rewrite",
    guide: `A polished rewrite of the draft that is ready to send or post.
- Keep the draft's format (do not turn it into an email unless it already is one).
- Make it clear, fluent and well structured; similar length or slightly shorter.`,
  },
  {
    id: "summary",
    label: "Short Summary",
    guide: `A short summary of the draft.
- One to three sentences; for long drafts, up to four bullet points starting with "•".
- Include only information that appears in the draft.`,
  },
];

export const LANGUAGES: LanguageOption[] = [
  {
    id: "ar_msa",
    label: "Arabic — Formal (MSA)",
    script: "ar",
    swap: "en_professional",
    guide: `Modern Standard Arabic (الفصحى): grammatically correct, clear and contemporary — not archaic or flowery. Use Arabic punctuation (، ؛ ؟).`,
  },
  {
    id: "ar_saudi_pro",
    label: "Arabic — Saudi Professional",
    script: "ar",
    swap: "en_professional",
    guide: `Arabic as written in Saudi workplaces: clear Modern Standard Arabic with the natural, warm and respectful courtesy common in Saudi business communication (for example "السلام عليكم"، "أتمنى أن تكونوا بخير"، "شاكر ومقدّر تعاونكم"، "تحياتي"). Sound like a Saudi professional wrote it: avoid stiff, archaic or literally translated phrasing, and avoid dialect slang. Use Arabic punctuation (، ؛ ؟).`,
  },
  {
    id: "ar_saudi_casual",
    label: "Arabic — Saudi Casual",
    script: "ar",
    swap: "en_casual",
    guide: `Everyday Saudi colloquial Arabic as people write it in chats (for example "هلا"، "وش"، "أبغى"، "يعطيك العافية"، "إن شاء الله"). Natural and light — not Modern Standard Arabic and not exaggerated.`,
  },
  {
    id: "en_professional",
    label: "English — Professional",
    script: "en",
    swap: "ar_saudi_pro",
    guide: `Clear, natural, professional international English.`,
  },
  {
    id: "en_casual",
    label: "English — Casual",
    script: "en",
    swap: "ar_saudi_casual",
    guide: `Relaxed, natural everyday English; contractions are fine.`,
  },
];

export const TONES: Option[] = [
  { id: "formal", label: "Formal", guide: "Formal: respectful and dignified, complete sentences, no contractions or slang." },
  { id: "professional", label: "Professional", guide: "Professional: courteous, confident and efficient; business-appropriate without sounding stiff." },
  { id: "friendly", label: "Friendly", guide: "Friendly: warm, positive and approachable while staying clear." },
  { id: "casual", label: "Casual", guide: "Casual: relaxed and conversational with simple words." },
  { id: "polite", label: "Polite", guide: "Polite: especially courteous and considerate; soften requests (\"could you kindly\", \"I would appreciate it if\" / \"أرجو التكرم\"، \"أكون شاكراً لو\") and thank the reader." },
  { id: "direct", label: "Direct", guide: "Direct: state the point or request in the first sentence; no filler and only minimal pleasantries." },
  { id: "concise", label: "Concise", guide: "Concise: as short as possible while still complete; cut every unnecessary word." },
];

export const byId = <T extends Option>(list: T[], id: string | null | undefined): T =>
  list.find((o) => o.id === id) ?? list[0];

export const isValid = (list: Option[], id: string | null | undefined): id is string =>
  !!id && list.some((o) => o.id === id);
