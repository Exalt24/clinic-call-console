import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { RedactedTextComponent } from './redacted-text';

@Component({ imports: [RedactedTextComponent], template: `<app-redacted-text [text]="text" />` })
class Host {
  text = '';
}

function render(text: string): HTMLElement {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.text = text;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('RedactedTextComponent', () => {
  it('draws each placeholder as a tag with an accessible name', () => {
    const el = render('call [PHONE] or email [EMAIL]');
    const tags = Array.from(el.querySelectorAll('.mask'));
    expect(tags.map((t) => t.getAttribute('aria-label'))).toEqual(['redacted phone number', 'redacted email address']);
    expect(tags.map((t) => t.textContent?.trim())).toEqual(['PHONE', 'EMAIL']);
  });

  it('adds no whitespace of its own around a tag', () => {
    // "my name is [NAME]." must read "my name is NAME." and not "my name is NAME ."
    expect(render('my name is [NAME].').textContent).toBe('my name is NAME.');
    expect(render('[DOB][SSN]').textContent).toBe('DOBSSN');
  });

  it('renders text with no placeholder unchanged, and an empty string as nothing', () => {
    expect(render('Tuesday at 9:30').textContent).toBe('Tuesday at 9:30');
    expect(render('').textContent).toBe('');
  });

  it('shows underscore kinds as words', () => {
    expect(render('id [INSURANCE_ID]').querySelector('.mask')?.textContent?.trim()).toBe('INSURANCE ID');
  });
});
