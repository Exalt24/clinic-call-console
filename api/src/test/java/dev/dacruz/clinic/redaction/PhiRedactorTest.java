package dev.dacruz.clinic.redaction;

import static org.assertj.core.api.Assertions.assertThat;

import dev.dacruz.clinic.redaction.PhiRedactor.Kind;
import java.util.List;
import org.junit.jupiter.api.Test;

class PhiRedactorTest {

    private final PhiRedactor redactor = new PhiRedactor();

    private PhiRedactor.Result run(String text, String... names) {
        return redactor.redact(text, List.of(names));
    }

    @Test
    void masksPhoneNumbersInTheFormatsCallersActuallySpeak() {
        assertThat(run("call me on (415) 555-0142 or 415-555-0187 or 415.555.0199 or +1 415 555 0123").text())
                .isEqualTo("call me on [PHONE] or [PHONE] or [PHONE] or [PHONE]");
    }

    @Test
    void masksSocialSecurityNumberBeforeThePhonePatternCanEatPartOfIt() {
        PhiRedactor.Result r = run("my social is 923-45-6789 thanks");
        assertThat(r.text()).isEqualTo("my social is [SSN] thanks");
        assertThat(r.counts().get(Kind.SSN)).isEqualTo(1);
        assertThat(r.counts().get(Kind.PHONE)).isZero();
    }

    @Test
    void masksBirthDatesInWrittenAndNumericForms() {
        // the birth phrase stays so the sentence still reads; only the date is masked
        assertThat(run("I was born on March 3rd, 1984.").text()).isEqualTo("I was born on [DOB].");
        assertThat(run("Date of birth is 03/14/1979 please").text()).isEqualTo("Date of birth is [DOB] please");
        assertThat(run("DOB 3-4-84").text()).isEqualTo("DOB [DOB]");
        assertThat(run("born 1984").text()).isEqualTo("born 1984");   // a bare year is not a full date, left alone
    }

    @Test
    void leavesAppointmentDatesAndTimesVisibleOnPurpose() {
        // Documented limit: a reviewer needs the slot to judge the call. A production system would apply the full Safe Harbor list.
        assertThat(run("I have Tuesday at 9:30 open").text()).isEqualTo("I have Tuesday at 9:30 open");
    }

    @Test
    void masksEmailMrnInsuranceIdAndStreetAddress() {
        PhiRedactor.Result r = run("email dana.whitfield@example.test, MRN 4821937, member ID: XQ8841920, mail it to 214 Maple Street.");
        assertThat(r.text()).isEqualTo("email [EMAIL], [MRN], [INSURANCE_ID], mail it to [ADDRESS]");
        assertThat(r.total()).isEqualTo(4);
    }

    @Test
    void masksAnIntroducedNameButKeepsTheIntroducingWords() {
        assertThat(run("Hi, my name is Dana Whitfield and I need a visit").text())
                .isEqualTo("Hi, my name is [NAME] and I need a visit");
    }

    @Test
    void masksTitledNames() {
        assertThat(run("please tell Mrs. Okafor and Dr. Park").text()).isEqualTo("please tell [NAME] and [NAME]");
    }

    @Test
    void masksTheKnownPatientNameWhereverItAppearsIncludingBareFirstName() {
        PhiRedactor.Result r = run("Thanks, Dana. Is Dana Whitfield's record updated? yes, whitfield", "Dana Whitfield");
        assertThat(r.text()).doesNotContainIgnoringCase("dana").doesNotContainIgnoringCase("whitfield");
        assertThat(r.counts().get(Kind.NAME)).isGreaterThanOrEqualTo(3);
    }

    @Test
    void doesNotMaskShortNamePartsThatWouldDamageOrdinaryWords() {
        // "Li Wu Chen": the parts "Li" and "Wu" are under 3 letters and are skipped, so ordinary text around them is
        // untouched while the long part and the full name are still masked.
        assertThat(run("li and wu waited; Chen called", "Li Wu Chen").text()).isEqualTo("li and wu waited; [NAME] called");
        assertThat(run("we can see wei chen on the list", "Wei Chen").text()).isEqualTo("we can see [NAME] on the list");
    }

    @Test
    void isIdempotentRedactingTwiceChangesNothing() {
        String once = run("call 415-555-0187, born on May 5, 1990, I'm Marcus Bell", "Marcus Bell").text();
        assertThat(redactor.redact(once, List.of("Marcus Bell")).text()).isEqualTo(once);
    }

    @Test
    void countsAndSummaryAreStableAndComplete() {
        PhiRedactor.Result r = run("call 415-555-0187 or 415-555-0188, born on May 5, 1990");
        assertThat(r.counts().get(Kind.PHONE)).isEqualTo(2);
        assertThat(r.counts().get(Kind.DOB)).isEqualTo(1);
        assertThat(r.summary()).isEqualTo("DOB:1,PHONE:2");
        assertThat(r.total()).isEqualTo(3);
    }

    @Test
    void emptyAndNullInputAreSafe() {
        assertThat(run("").text()).isEmpty();
        assertThat(redactor.redact(null, null).text()).isEmpty();
        assertThat(redactor.redact(null, null).summary()).isEmpty();
    }
}
