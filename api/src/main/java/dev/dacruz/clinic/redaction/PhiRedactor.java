package dev.dacruz.clinic.redaction;

import java.util.Collection;
import java.util.EnumMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Replaces protected health information in a transcript with typed placeholders such as [PHONE] or [NAME].
 *
 * Deliberately rule-based and explainable: every category is one named pattern, so a reviewer can say exactly why a span
 * was masked. It is NOT a substitute for a certified de-identification service. Known limits (also in the README):
 * free-text names the caller never introduces, and appointment dates, are not masked by pattern; names the system
 * already knows (the patient on the record) are masked wherever they appear.
 */
@Component
public class PhiRedactor {

    public enum Kind { SSN, MRN, EMAIL, DOB, PHONE, ADDRESS, INSURANCE_ID, NAME }

    public record Result(String text, Map<Kind, Integer> counts) {
        public int total() {
            return counts.values().stream().mapToInt(Integer::intValue).sum();
        }

        /** "PHONE:2,DOB:1", stable order, empty when nothing was masked. */
        public String summary() {
            StringBuilder sb = new StringBuilder();
            counts.forEach((k, v) -> {
                if (v > 0) {
                    if (sb.length() > 0) sb.append(',');
                    sb.append(k).append(':').append(v);
                }
            });
            return sb.toString();
        }
    }

    private static final Pattern SSN = Pattern.compile("\\b\\d{3}-\\d{2}-\\d{4}\\b");
    private static final Pattern MRN = Pattern.compile("\\bMRN[:#\\s-]*\\d{5,}\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern EMAIL = Pattern.compile("\\b[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b");
    // "born on March 3rd 1984", "date of birth is 03/04/1984", "DOB 3-4-84": the birth phrase plus the date after it.
    // Group 1 is the birth phrase (kept, so the sentence still reads), group 2 is the date (masked).
    private static final Pattern DOB = Pattern.compile(
            "(?i)(\\b(?:born(?:\\s+on)?|date\\s+of\\s+birth(?:\\s+is)?|dob(?:\\s+is)?)[:\\s]+)"
                    + "((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}"
                    + "|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})");
    private static final Pattern PHONE = Pattern.compile("(?<![\\w])(?:\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}(?![\\w])");
    private static final Pattern ADDRESS = Pattern.compile(
            "\\b\\d{1,5}\\s+(?:[A-Z][a-z]+\\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\\b\\.?");
    private static final Pattern INSURANCE_ID = Pattern.compile(
            "(?i)\\b(?:member|policy|subscriber|insurance)\\s+(?:id|number|no\\.?|#)[:#\\s]*[A-Z0-9-]{6,}\\b");
    // Self-introductions and titled names: "my name is Dana Whitfield", "this is Marcus Bell", "Mrs. Okafor".
    // The lead phrase is case-insensitive but the NAME is not: a name starts with a capital, so "my name is Dana Whitfield
    // and I" stops before "and" instead of swallowing it.
    private static final Pattern INTRO_NAME = Pattern.compile(
            "\\b(?i:my\\s+name\\s+is|this\\s+is|i\\s+am|i'm|speaking\\s+with|calling\\s+for)\\s+([A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+){0,2})");
    private static final Pattern TITLED_NAME = Pattern.compile("\\b(?:Mr|Mrs|Ms|Miss|Dr|Mx)\\.?\\s+[A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+)?");

    public Result redact(String text, Collection<String> knownNames) {
        Map<Kind, Integer> counts = new EnumMap<>(Kind.class);
        for (Kind k : Kind.values()) {
            counts.put(k, 0);
        }
        String out = text == null ? "" : text;
        // Order matters: structured identifiers first so a phone number is not eaten by the date or ID patterns.
        out = replace(out, SSN, "[SSN]", Kind.SSN, counts);
        out = replace(out, MRN, "[MRN]", Kind.MRN, counts);
        out = replace(out, EMAIL, "[EMAIL]", Kind.EMAIL, counts);
        out = replaceDob(out, counts);
        out = replace(out, INSURANCE_ID, "[INSURANCE_ID]", Kind.INSURANCE_ID, counts);
        out = replace(out, PHONE, "[PHONE]", Kind.PHONE, counts);
        out = replace(out, ADDRESS, "[ADDRESS]", Kind.ADDRESS, counts);
        out = replaceIntroducedNames(out, counts);
        out = replace(out, TITLED_NAME, "[NAME]", Kind.NAME, counts);
        if (knownNames != null) {
            for (String name : knownNames) {
                out = replaceKnownName(out, name, counts);
            }
        }
        return new Result(out, counts);
    }

    private static String replace(String in, Pattern p, String token, Kind kind, Map<Kind, Integer> counts) {
        Matcher m = p.matcher(in);
        int n = 0;
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            n++;
            m.appendReplacement(sb, Matcher.quoteReplacement(token));
        }
        m.appendTail(sb);
        counts.merge(kind, n, Integer::sum);
        return sb.toString();
    }

    private static String replaceDob(String in, Map<Kind, Integer> counts) {
        Matcher m = DOB.matcher(in);
        StringBuilder sb = new StringBuilder();
        int n = 0;
        while (m.find()) {
            n++;
            m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + "[DOB]"));
        }
        m.appendTail(sb);
        counts.merge(Kind.DOB, n, Integer::sum);
        return sb.toString();
    }

    private static String replaceIntroducedNames(String in, Map<Kind, Integer> counts) {
        Matcher m = INTRO_NAME.matcher(in);
        StringBuilder sb = new StringBuilder();
        int n = 0;
        while (m.find()) {
            n++;
            // keep the introducing words ("my name is"), mask only the name that follows
            String whole = m.group();
            String masked = whole.substring(0, whole.length() - m.group(1).length()) + "[NAME]";
            m.appendReplacement(sb, Matcher.quoteReplacement(masked));
        }
        m.appendTail(sb);
        counts.merge(Kind.NAME, n, Integer::sum);
        return sb.toString();
    }

    private static Pattern wordPattern(String word) {
        return Pattern.compile("\\b" + Pattern.quote(word) + "\\b", Pattern.CASE_INSENSITIVE);
    }

    private static String replaceKnownName(String in, String name, Map<Kind, Integer> counts) {
        if (name == null || name.isBlank()) {
            return in;
        }
        String full = name.trim().replaceAll("\\s+", " ");
        // the full name first, then each part of 3+ letters, so a bare "Dana" is masked after "Dana Whitfield" was
        String out = replace(in, wordPattern(full), "[NAME]", Kind.NAME, counts);
        for (String part : full.split(" ")) {
            if (part.length() >= 3) {
                out = replace(out, wordPattern(part), "[NAME]", Kind.NAME, counts);
            }
        }
        return out;
    }
}
