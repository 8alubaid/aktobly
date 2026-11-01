// Terminology hints for Arabic output. Small Llama models often mistranslate or invent
// transliterations for technical and business terms; when a draft contains one of these,
// the prompt tells the model the accepted Arabic rendering. Order: specific before general.

const TERMS: [RegExp, string][] = [
  [/\bcloud\s+(engineer|engineering)s?\b/i, "cloud engineer = مهندس حوسبة سحابية (Cloud Engineer)"],
  [/\bcloud\s+architect/i, "cloud architect = مهندس معماري للحوسبة السحابية (Cloud Architect)"],
  [/\bcloud\b/i, "cloud = الحوسبة السحابية (Cloud)"],
  [/\bsoftware\s+(engineer|developer)s?\b/i, "software engineer/developer = مهندس برمجيات / مطوّر برمجيات"],
  [/\bdata\s+scientists?\b/i, "data scientist = عالم بيانات"],
  [/\bdata\s+(analyst|analysis)/i, "data analyst = محلل بيانات"],
  [/\bdata\s+engineers?\b/i, "data engineer = مهندس بيانات"],
  [/\bdev\s?ops\b/i, "DevOps = DevOps (keep in Latin script)"],
  [/\bcyber\s?security\b/i, "cybersecurity = الأمن السيبراني"],
  [/\bnetwork\s+engineers?\b/i, "network engineer = مهندس شبكات"],
  [/\bfront[\s-]?end\b/i, "frontend = الواجهات الأمامية (Frontend)"],
  [/\bback[\s-]?end\b/i, "backend = الأنظمة الخلفية (Backend)"],
  [/\bfull[\s-]?stack\b/i, "full stack = Full Stack (keep in Latin script)"],
  [/\b(machine learning|ML)\b/, "machine learning = تعلّم الآلة"],
  [/\b(AI|artificial intelligence)\b/i, "AI = الذكاء الاصطناعي"],
  [/\bproject\s+managers?\b/i, "project manager = مدير مشروع"],
  [/\bproduct\s+managers?\b/i, "product manager = مدير منتج"],
  [/\b(new|fresh|recent)\s+grad(uate)?s?\b/i, "new grad = حديث التخرج / خريج حديث"],
  [/\bco-?op\b/i, "co-op = تدريب تعاوني"],
  [/\bintern(ship)?s?\b/i, "internship = فرصة تدريب / متدرب"],
  [/\b(job\s+)?application\b/i, "job application = طلب التوظيف"],
  [/\binterview/i, "interview = مقابلة"],
  [/\b(resume|cv)\b/i, "resume/CV = السيرة الذاتية"],
  [/\bdeadline/i, "deadline = الموعد النهائي"],
  [/\binvoice/i, "invoice = فاتورة"],
  [/\bHR\b/, "HR = الموارد البشرية"],
  [/\bonboarding\b/i, "onboarding = إجراءات الانضمام"],
];

/** Glossary lines relevant to this draft (only matters when writing Arabic). */
export function glossaryFor(draft: string): string[] {
  const hits: string[] = [];
  let rest = draft;
  for (const [re, hint] of TERMS) {
    if (re.test(rest)) {
      hits.push(hint);
      // Prevent "cloud" from also matching after "cloud engineer" did.
      rest = rest.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), " ");
    }
  }
  return hits;
}
