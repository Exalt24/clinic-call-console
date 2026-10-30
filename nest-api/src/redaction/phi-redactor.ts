/**
 * Replaces protected health information in a transcript with typed placeholders such as [PHONE] or [NAME].
 *
 * Rule-based and explainable, a port of the Spring Boot API's redactor: every category is one named pattern. It is not a
 * substitute for a certified de-identification service. Free-text names the caller never introduces and appointment dates
 * are not masked by pattern; names the system already knows (the patient on the record) are masked wherever they appear.
 */
export const KINDS = ['SSN', 'MRN', 'EMAIL', 'DOB', 'PHONE', 'ADDRESS', 'INSURANCE_ID', 'NAME'] as const;
export type Kind = (typeof KINDS)[number];

export interface RedactResult {
  text: string;
  counts: Record<Kind, number>;
  total: number;
  /** "PHONE:2,DOB:1", stable order, empty when nothing was masked. */
  summary: string;
}

/** A case-insensitive literal phrase written as character classes, so the name that follows can stay case-sensitive. */
function ci(phrase: string): string {
  return phrase
    .split('')
    .map((ch) => (ch === ' ' ? '\\s+' : /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch))
    .join('');
}

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const MRN = /\bMRN[:#\s-]*\d{5,}\b/gi;
const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
// "born on March 3rd 1984", "date of birth is 03/04/1984", "DOB 3-4-84": group 1 is the birth phrase (kept), group 2 the date.
const DOB =
  /(\b(?:born(?:\s+on)?|date\s+of\s+birth(?:\s+is)?|dob(?:\s+is)?)[:\s]+)((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/gi;
const PHONE = /(?<![\w])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/g;
const ADDRESS = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\b\.?/g;
const INSURANCE_ID = /\b(?:member|policy|subscriber|insurance)\s+(?:id|number|no\.?|#)[:#\s]*[A-Z0-9-]{6,}\b/gi;
// "my name is Dana Whitfield", "this is Marcus Bell": the lead phrase is case-insensitive, the NAME is not, so
// "my name is Dana Whitfield and I" stops before "and".
const INTRO_NAME = new RegExp(
  `\\b(${['my name is', 'this is', 'i am', "i'm", 'speaking with', 'calling for'].map(ci).join('|')})\\s+([A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+){0,2})`,
  'g',
);
const TITLED_NAME = /\b(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/g;

function replace(text: string, re: RegExp, token: string, kind: Kind, counts: Record<Kind, number>): string {
  let n = 0;
  const out = text.replace(re, () => {
    n++;
    return token;
  });
  counts[kind] += n;
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceKnownName(text: string, name: string, counts: Record<Kind, number>): string {
  if (!name || !name.trim()) return text;
  const full = name.trim().replace(/\s+/g, ' ');
  let out = replace(text, new RegExp(`\\b${escapeRegex(full)}\\b`, 'gi'), '[NAME]', 'NAME', counts);
  for (const part of full.split(' ')) {
    if (part.length >= 3) out = replace(out, new RegExp(`\\b${escapeRegex(part)}\\b`, 'gi'), '[NAME]', 'NAME', counts);
  }
  return out;
}

export function redact(text: string | null | undefined, knownNames: string[] = []): RedactResult {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  let out = text ?? '';
  // Order matters: structured identifiers first so a phone number is not eaten by the date or ID patterns.
  out = replace(out, SSN, '[SSN]', 'SSN', counts);
  out = replace(out, MRN, '[MRN]', 'MRN', counts);
  out = replace(out, EMAIL, '[EMAIL]', 'EMAIL', counts);
  out = out.replace(DOB, (_m, lead: string) => {
    counts.DOB++;
    return `${lead}[DOB]`;
  });
  out = replace(out, INSURANCE_ID, '[INSURANCE_ID]', 'INSURANCE_ID', counts);
  out = replace(out, PHONE, '[PHONE]', 'PHONE', counts);
  out = replace(out, ADDRESS, '[ADDRESS]', 'ADDRESS', counts);
  // keep the introducing words ("my name is"), mask only the name that follows
  out = out.replace(INTRO_NAME, (_m, lead: string) => {
    counts.NAME++;
    return `${lead} [NAME]`;
  });
  out = replace(out, TITLED_NAME, '[NAME]', 'NAME', counts);
  for (const name of knownNames) out = replaceKnownName(out, name, counts);

  const total = KINDS.reduce((sum, k) => sum + counts[k], 0);
  const summary = KINDS.filter((k) => counts[k] > 0)
    .map((k) => `${k}:${counts[k]}`)
    .join(',');
  return { text: out, counts, total, summary };
}
