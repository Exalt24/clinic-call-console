import { redact } from './phi-redactor';

describe('PHI redactor', () => {
  it('masks a social security number', () => {
    const r = redact('My social is 901-23-4567 if you need it.');
    expect(r.text).toBe('My social is [SSN] if you need it.');
    expect(r.counts.SSN).toBe(1);
  });

  it('masks record numbers, emails and insurance ids', () => {
    const r = redact('MRN 4123456, mail dana.w@example.test, Member ID: XQ1234567.');
    expect(r.text).toBe('[MRN], mail [EMAIL], [INSURANCE_ID].');
    expect(r.summary).toBe('MRN:1,EMAIL:1,INSURANCE_ID:1');
  });

  it('masks the date after a birth phrase and keeps the phrase', () => {
    expect(redact('I was born on March 3rd, 1984.').text).toBe('I was born on [DOB].');
    expect(redact('Date of birth is 03/04/1984').text).toBe('Date of birth is [DOB]');
    expect(redact('DOB 3-4-84').text).toBe('DOB [DOB]');
  });

  it('leaves an appointment date alone on purpose', () => {
    expect(redact('I have Tuesday at 9:30 open on 10/30/2026.').text).toBe('I have Tuesday at 9:30 open on 10/30/2026.');
  });

  it.each(['(415) 555-0142', '415-555-0142', '+1 415 555 0142', '4155550142'])('masks the phone number %s', (p) => {
    const r = redact(`call me at ${p} please`);
    expect(r.text).toBe('call me at [PHONE] please');
  });

  it('masks a street address', () => {
    expect(redact('Mail it to 214 Maple Street.').text).toBe('Mail it to [ADDRESS]');
  });

  it('masks an introduced name but keeps the introducing words and stops before "and"', () => {
    expect(redact('Hi, my name is Dana Whitfield and I need a visit.').text).toBe('Hi, my name is [NAME] and I need a visit.');
    expect(redact('MY NAME IS Marcus Bell').text).toBe('MY NAME IS [NAME]');
    expect(redact('this is Priya').text).toBe('this is [NAME]');
  });

  it('masks a titled name', () => {
    expect(redact('Please tell Dr. Okonkwo and Mrs. Alvarez Ruiz.').text).toBe('Please tell [NAME] and [NAME].');
  });

  it('masks the known patient name wherever it appears, whole and in parts, in any case', () => {
    const r = redact('Thank you, dana. Is that WHITFIELD or Dana Whitfield?', ['Dana Whitfield']);
    expect(r.text).toBe('Thank you, [NAME]. Is that [NAME] or [NAME]?');
    expect(r.counts.NAME).toBe(3);
  });

  it('does not treat the name as a pattern', () => {
    expect(redact('Call (555) 010-0000 now', ['(.*)']).text).toContain('[PHONE]');
  });

  it('counts a mixed transcript and summarises it in a stable order', () => {
    const r = redact('Dana at 415-555-0142, born on March 3, 1984, dana@example.test', ['Dana']);
    expect(r.summary).toBe('EMAIL:1,DOB:1,PHONE:1,NAME:1');
    expect(r.total).toBe(4);
  });

  it('returns an empty result for empty input', () => {
    expect(redact('')).toMatchObject({ text: '', total: 0, summary: '' });
    expect(redact(null).text).toBe('');
  });
});
