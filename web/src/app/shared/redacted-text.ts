import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { maskLabel, segments } from './format';

/**
 * Draws a transcript line with each redaction placeholder as a tag. The tag carries an accessible name ("redacted phone
 * number") and does not rely on colour alone: it has a dot mark and its type spelled out.
 *
 * The template is written without whitespace between segments on purpose: a space the template adds is a space the reader
 * sees, so "my name is [NAME]." must not render as "my name is NAME ." (a regression test pins this).
 */
@Component({
  selector: 'app-redacted-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (s of parts(); track $index) {@if (s.type === 'mask') {<span class="mask" role="img" [attr.aria-label]="'redacted ' + label(s.value)"><span class="dot" aria-hidden="true"></span>{{ short(s.value) }}</span>} @else {<ng-container>{{ s.value }}</ng-container>}}`,
  styles: `
    .mask {
      display: inline-flex; align-items: center; gap: .3em; padding: .05em .55em; margin: 0 .05em;
      border-radius: 999px; background: var(--mask-bg); color: var(--mask-ink); border: 1px solid var(--mask-line);
      font-size: .78em; font-weight: 600; letter-spacing: .02em; line-height: 1.5; vertical-align: .08em;
      white-space: nowrap;
    }
    .dot { width: .5em; height: .5em; border-radius: 50%; background: currentColor; opacity: .55; }
  `,
})
export class RedactedTextComponent {
  readonly text = input.required<string>();
  protected readonly parts = computed(() => segments(this.text()));
  protected label = maskLabel;
  protected short(kind: string): string {
    return kind.replace('_', ' ');
  }
}
