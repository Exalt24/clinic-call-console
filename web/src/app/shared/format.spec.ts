import { describe, expect, it } from 'vitest';
import { formatDuration, maskLabel, parsePhiSummary, segments } from './format';

describe('segments', () => {
  it('splits text around mask placeholders and keeps the order', () => {
    expect(segments('call [PHONE] about [NAME] today')).toEqual([
      { type: 'text', value: 'call ' },
      { type: 'mask', value: 'PHONE' },
      { type: 'text', value: ' about ' },
      { type: 'mask', value: 'NAME' },
      { type: 'text', value: ' today' },
    ]);
  });

  it('handles text with no masks, an empty string, and masks at both ends', () => {
    expect(segments('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
    expect(segments('')).toEqual([]);
    expect(segments('[DOB][SSN]')).toEqual([
      { type: 'mask', value: 'DOB' },
      { type: 'mask', value: 'SSN' },
    ]);
  });

  it('does not treat ordinary bracketed words as masks', () => {
    expect(segments('see [note] and [1] and [a]')).toEqual([{ type: 'text', value: 'see [note] and [1] and [a]' }]);
  });

  it('accepts the underscore kinds the API produces', () => {
    expect(segments('id [INSURANCE_ID]')).toContainEqual({ type: 'mask', value: 'INSURANCE_ID' });
  });
});

describe('parsePhiSummary', () => {
  it('parses the API summary into kinds and counts', () => {
    expect(parsePhiSummary('DOB:1,PHONE:2')).toEqual([
      { kind: 'DOB', count: 1 },
      { kind: 'PHONE', count: 2 },
    ]);
  });

  it('returns an empty list for an empty summary and drops zero or malformed entries', () => {
    expect(parsePhiSummary('')).toEqual([]);
    expect(parsePhiSummary('PHONE:0,DOB:x,NAME:3')).toEqual([{ kind: 'NAME', count: 3 }]);
  });
});

describe('formatDuration', () => {
  it('formats seconds, whole minutes and minutes with seconds', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(142)).toBe('2m 22s');
    expect(formatDuration(605)).toBe('10m 05s');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('maskLabel', () => {
  it('spells a kind out and falls back for an unknown one', () => {
    expect(maskLabel('PHONE')).toBe('phone number');
    expect(maskLabel('INSURANCE_ID')).toBe('insurance ID');
    expect(maskLabel('SOMETHING_NEW')).toBe('something_new');
  });
});
