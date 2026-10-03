package dev.dacruz.clinic.seed;

import dev.dacruz.clinic.calls.CallDtos.IngestLine;
import dev.dacruz.clinic.calls.CallDtos.IngestRequest;
import dev.dacruz.clinic.calls.CallRecord;
import dev.dacruz.clinic.calls.CallRepository;
import dev.dacruz.clinic.calls.CallService;
import dev.dacruz.clinic.config.AppProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Fills an empty database with SYNTHETIC calls: invented names, 555-01xx phone numbers, made-up dates of birth. It goes
 * through CallService.ingest, the same path the webhook uses, so seeded rows are encrypted and redacted exactly like real
 * deliveries. Deterministic (fixed seed), so screenshots and tests are repeatable.
 */
@Component
public class DemoDataSeeder implements ApplicationRunner {

    private static final String[] NAMES = {
            "Dana Whitfield", "Marcus Bell", "Priya Raman", "Tomas Herrera", "Elena Okafor", "Jordan Pike",
            "Sofia Lindgren", "Wei Chen", "Naomi Frazier", "Ahmed Haddad", "Grace Mutua", "Liam Doyle",
            "Hannah Brooks", "Mateo Alvarez", "Ingrid Solberg", "Kofi Mensah", "Rosa Delgado", "Owen Park"};
    private static final String[] AGENTS = {"Front desk agent", "After-hours agent", "Scheduling agent"};
    private static final String[] STREETS = {"Maple Street", "Oak Avenue", "Cedar Road", "Willow Drive", "Birch Lane"};
    private static final String[] MONTHS = {"January", "February", "March", "April", "May", "June", "July", "August",
            "September", "October", "November", "December"};
    private static final String[] SLOTS = {"Tuesday at 9:30", "Wednesday at 2:15", "Thursday at 11:00", "Friday at 4:45", "Monday at 8:15"};

    private final CallService calls;
    private final CallRepository repo;
    private final AppProperties props;
    private final Clock clock;
    private final TransactionTemplate tx;

    public DemoDataSeeder(CallService calls, CallRepository repo, AppProperties props, Clock clock, TransactionTemplate tx) {
        this.calls = calls;
        this.repo = repo;
        this.props = props;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.seed().enabled() || repo.count() > 0) {
            return;
        }
        Random rnd = new Random(42);
        Instant base = clock.instant().minus(Duration.ofHours(2));
        List<UUIDHolder> created = new ArrayList<>();
        for (int i = 0; i < props.seed().count(); i++) {
            String name = NAMES[rnd.nextInt(NAMES.length)];
            CallRecord.Reason reason = CallRecord.Reason.values()[rnd.nextInt(4)];
            List<IngestLine> lines = script(rnd, name, reason);
            CallRecord.Outcome outcome = pickOutcome(rnd, reason);
            Instant at = base.minus(Duration.ofMinutes(37L * i + rnd.nextInt(25)));
            var res = calls.ingest(new IngestRequest("seed-" + i, at, 70 + rnd.nextInt(280),
                    AGENTS[rnd.nextInt(AGENTS.length)], phone(rnd), reason, outcome, name, lines));
            created.add(new UUIDHolder(res.id(), i));
        }
        // A realistic mix: most calls are new, a few are being reviewed, older ones are done.
        tx.executeWithoutResult(s -> {
            for (UUIDHolder h : created) {
                CallRecord.Status st = h.index() >= 24 ? CallRecord.Status.RESOLVED
                        : (h.index() % 5 == 2 ? CallRecord.Status.IN_REVIEW : CallRecord.Status.NEW);
                repo.findById(h.id()).ifPresent(c -> c.setStatus(st));
            }
        });
    }

    private record UUIDHolder(java.util.UUID id, int index) {}

    private static CallRecord.Outcome pickOutcome(Random rnd, CallRecord.Reason reason) {
        int r = rnd.nextInt(10);
        if (reason == CallRecord.Reason.APPOINTMENT) {
            return r < 6 ? CallRecord.Outcome.BOOKED : (r < 8 ? CallRecord.Outcome.HANDED_OFF : CallRecord.Outcome.UNRESOLVED);
        }
        return r < 5 ? CallRecord.Outcome.INFO_GIVEN : (r < 8 ? CallRecord.Outcome.HANDED_OFF : CallRecord.Outcome.UNRESOLVED);
    }

    private static String phone(Random rnd) {
        // 555-01xx is the block reserved for fiction; nothing here dials a real person.
        int area = 200 + rnd.nextInt(700);
        String fmt = rnd.nextBoolean() ? "(%d) 555-01%02d" : "%d-555-01%02d";
        return String.format(fmt, area, rnd.nextInt(100));
    }

    private static String dob(Random rnd) {
        int m = rnd.nextInt(12);
        int d = 1 + rnd.nextInt(27);
        int y = 1948 + rnd.nextInt(58);
        return rnd.nextBoolean() ? MONTHS[m] + " " + d + ", " + y : String.format("%02d/%02d/%d", m + 1, d, y);
    }

    private static List<IngestLine> script(Random rnd, String name, CallRecord.Reason reason) {
        String first = name.split(" ")[0];
        String ph = phone(rnd);
        String addr = (100 + rnd.nextInt(890)) + " " + STREETS[rnd.nextInt(STREETS.length)];
        String slot = SLOTS[rnd.nextInt(SLOTS.length)];
        List<IngestLine> out = new ArrayList<>();
        out.add(new IngestLine("AGENT", "Thanks for calling Riverside Family Clinic. I'm the virtual assistant. How can I help?"));
        switch (reason) {
            case APPOINTMENT -> {
                out.add(new IngestLine("CALLER", "Hi, my name is " + name + ". I need to book a visit with Dr. Okonkwo."));
                out.add(new IngestLine("AGENT", "Happy to help. Can I confirm your date of birth?"));
                out.add(new IngestLine("CALLER", "I was born on " + dob(rnd) + "."));
                out.add(new IngestLine("AGENT", "Thank you, " + first + ". I have " + slot + " open. Does that work?"));
                out.add(new IngestLine("CALLER", "Yes. You can text me the reminder at " + ph + "."));
                out.add(new IngestLine("AGENT", "Booked. A reminder will go to " + ph + ". Anything else?"));
                out.add(new IngestLine("CALLER", "No, that's everything."));
            }
            case INSURANCE -> {
                out.add(new IngestLine("CALLER", "This is " + name + ". I want to check my insurance is accepted."));
                out.add(new IngestLine("AGENT", "I can check that. What is your member ID?"));
                out.add(new IngestLine("CALLER", "Member ID: " + id(rnd) + ". My date of birth is " + dob(rnd) + "."));
                out.add(new IngestLine("AGENT", "Thanks. I'll send the confirmation to your email. What is it?"));
                out.add(new IngestLine("CALLER", first.toLowerCase() + "." + name.split(" ")[1].toLowerCase() + "@example.test"));
                out.add(new IngestLine("AGENT", "Your plan is in network. I've noted it on your chart."));
            }
            case BILLING -> {
                out.add(new IngestLine("CALLER", "I'm calling about a bill. I'm " + name + ", MRN " + (4000000 + rnd.nextInt(900000)) + "."));
                out.add(new IngestLine("AGENT", "I can see a statement. The balance is $" + (40 + rnd.nextInt(300)) + ". Would you like to set up a plan?"));
                out.add(new IngestLine("CALLER", "Please mail the statement to " + addr + "."));
                out.add(new IngestLine("AGENT", "Done. A billing specialist will call you back at " + ph + " to confirm."));
            }
            case REFILL -> {
                out.add(new IngestLine("CALLER", "Hello, " + first + " here. I need a refill on my usual blood pressure medication."));
                out.add(new IngestLine("AGENT", "I'll pass that to the care team. Can I verify your date of birth?"));
                out.add(new IngestLine("CALLER", "Date of birth is " + dob(rnd) + ". My social is " + ssn(rnd) + " if you need it."));
                out.add(new IngestLine("AGENT", "I don't need that, and please don't share it on this line. A nurse will return your call at " + ph + "."));
            }
            default -> out.add(new IngestLine("CALLER", "What time do you close on Fridays?"));
        }
        return out;
    }

    private static String id(Random rnd) {
        return "XQ" + (1000000 + rnd.nextInt(8000000));
    }

    private static String ssn(Random rnd) {
        return String.format("%03d-%02d-%04d", 900 + rnd.nextInt(99), 10 + rnd.nextInt(80), 1000 + rnd.nextInt(8999));
    }
}
