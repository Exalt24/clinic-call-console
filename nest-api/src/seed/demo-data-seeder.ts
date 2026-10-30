import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IngestDto, IngestLineDto } from '../calls/calls.dto';
import { CallOutcome, CallReason, CallRecord, CallStatus } from '../calls/call-record.entity';
import { CallsService } from '../calls/calls.service';
import { APP_CONFIG, AppConfig } from '../config/config';

const NAMES = [
  'Dana Whitfield', 'Marcus Bell', 'Priya Raman', 'Tomas Herrera', 'Elena Okafor', 'Jordan Pike',
  'Sofia Lindgren', 'Wei Chen', 'Naomi Frazier', 'Ahmed Haddad', 'Grace Mutua', 'Liam Doyle',
  'Hannah Brooks', 'Mateo Alvarez', 'Ingrid Solberg', 'Kofi Mensah', 'Rosa Delgado', 'Owen Park',
];
const AGENTS = ['Front desk agent', 'After-hours agent', 'Scheduling agent'];
const STREETS = ['Maple Street', 'Oak Avenue', 'Cedar Road', 'Willow Drive', 'Birch Lane'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLOTS = ['Tuesday at 9:30', 'Wednesday at 2:15', 'Thursday at 11:00', 'Friday at 4:45', 'Monday at 8:15'];
const REASONS: CallReason[] = ['APPOINTMENT', 'INSURANCE', 'BILLING', 'REFILL'];

/** A small deterministic generator (mulberry32), so the seeded queue is the same on every start and in every test. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (n: number) => Math.floor(next() * n), bool: () => next() < 0.5 };
}
type Rnd = ReturnType<typeof rng>;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// 555-01xx is the block reserved for fiction; nothing here dials a real person.
function phone(r: Rnd): string {
  const area = 200 + r.int(700);
  return r.bool() ? `(${area}) 555-01${pad(r.int(100))}` : `${area}-555-01${pad(r.int(100))}`;
}

function dob(r: Rnd): string {
  const m = r.int(12);
  const d = 1 + r.int(27);
  const y = 1948 + r.int(58);
  return r.bool() ? `${MONTHS[m]} ${d}, ${y}` : `${pad(m + 1)}/${pad(d)}/${y}`;
}

const ssn = (r: Rnd) => `${900 + r.int(99)}-${10 + r.int(80)}-${1000 + r.int(8999)}`;
const memberId = (r: Rnd) => `XQ${1000000 + r.int(8000000)}`;
const line = (speaker: string, text: string): IngestLineDto => ({ speaker, text });

// COPY-OK: every string in script() is a synthetic phone-call transcript line fed to the redactor, not screen text
function script(r: Rnd, name: string, reason: CallReason): IngestLineDto[] {
  const [first, last] = name.split(' ');
  const ph = phone(r);
  const addr = `${100 + r.int(890)} ${STREETS[r.int(STREETS.length)]}`;
  const slot = SLOTS[r.int(SLOTS.length)];
  // COPY-OK: synthetic transcript
  const out = [line('AGENT', "Thanks for calling Riverside Family Clinic. I'm the virtual assistant. How can I help?")];
  switch (reason) {
    case 'APPOINTMENT':
      out.push(
        // COPY-OK: synthetic transcript
        line('CALLER', `Hi, my name is ${name}. I need to book a visit with Dr. Okonkwo.`),
        // COPY-OK: synthetic transcript
        line('AGENT', 'Happy to help. Can I confirm your date of birth?'),
        line('CALLER', `I was born on ${dob(r)}.`),
        // COPY-OK: synthetic transcript
        line('AGENT', `Thank you, ${first}. I have ${slot} open. Does that work?`),
        line('CALLER', `Yes. You can text me the reminder at ${ph}.`),
        // COPY-OK: synthetic transcript
        line('AGENT', `Booked. A reminder will go to ${ph}. Anything else?`),
        line('CALLER', "No, that's everything."),
      );
      break;
    case 'INSURANCE':
      out.push(
        line('CALLER', `This is ${name}. I want to check my insurance is accepted.`),
        line('AGENT', 'I can check that. What is your member ID?'),
        line('CALLER', `Member ID: ${memberId(r)}. My date of birth is ${dob(r)}.`),
        // COPY-OK: synthetic transcript
        line('AGENT', "Thanks. I'll send the confirmation to your email. What is it?"),
        line('CALLER', `${first.toLowerCase()}.${last.toLowerCase()}@example.test`),
        line('AGENT', "Your plan is in network. I've noted it on your chart."),
      );
      break;
    case 'BILLING':
      out.push(
        line('CALLER', `I'm calling about a bill. I'm ${name}, MRN ${4000000 + r.int(900000)}.`),
        // COPY-OK: synthetic transcript
        line('AGENT', `I can see a statement. The balance is $${40 + r.int(300)}. Would you like to set up a plan?`),
        line('CALLER', `Please mail the statement to ${addr}.`),
        line('AGENT', `Done. A billing specialist will call you back at ${ph} to confirm.`),
      );
      break;
    case 'REFILL':
      out.push(
        line('CALLER', `Hello, ${first} here. I need a refill on my usual blood pressure medication.`),
        line('AGENT', "I'll pass that to the care team. Can I verify your date of birth?"),
        line('CALLER', `Date of birth is ${dob(r)}. My social is ${ssn(r)} if you need it.`),
        line('AGENT', `I don't need that, and please don't share it on this line. A nurse will return your call at ${ph}.`),
      );
      break;
    default:
      out.push(line('CALLER', 'What time do you close on Fridays?'));
  }
  return out;
}

function pickOutcome(r: Rnd, reason: CallReason): CallOutcome {
  const n = r.int(10);
  if (reason === 'APPOINTMENT') return n < 6 ? 'BOOKED' : n < 8 ? 'HANDED_OFF' : 'UNRESOLVED';
  return n < 5 ? 'INFO_GIVEN' : n < 8 ? 'HANDED_OFF' : 'UNRESOLVED';
}

/**
 * Fills an empty database with SYNTHETIC calls: invented names, 555-01xx phone numbers, made-up dates of birth. It goes
 * through CallsService.ingest, the same path the webhook uses, so seeded rows are encrypted and redacted exactly like real
 * deliveries.
 */
@Injectable()
export class DemoDataSeeder implements OnApplicationBootstrap {
  constructor(
    private readonly calls: CallsService,
    private readonly ds: DataSource,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.seedEnabled || (await this.ds.getRepository(CallRecord).count()) > 0) return;
    const r = rng(42);
    const base = Date.now() - 2 * 3600_000;
    const created: { id: string; index: number }[] = [];
    for (let i = 0; i < this.cfg.seedCount; i++) {
      const name = NAMES[r.int(NAMES.length)];
      const reason = REASONS[r.int(REASONS.length)];
      const lines = script(r, name, reason);
      const outcome = pickOutcome(r, reason);
      const at = new Date(base - (37 * i + r.int(25)) * 60_000);
      const dto: IngestDto = {
        externalId: `seed-${i}`,
        startedAt: at.toISOString(),
        durationSec: 70 + r.int(280),
        agent: AGENTS[r.int(AGENTS.length)],
        callerNumber: phone(r),
        reason,
        outcome,
        patientName: name,
        transcript: lines,
      };
      const res = await this.calls.ingest(dto);
      created.push({ id: res.id, index: i });
    }
    // A realistic mix: most calls are new, a few are being reviewed, older ones are done.
    for (const h of created) {
      const status: CallStatus = h.index >= 24 ? 'RESOLVED' : h.index % 5 === 2 ? 'IN_REVIEW' : 'NEW';
      await this.ds.getRepository(CallRecord).update({ id: h.id }, { status });
    }
  }
}
