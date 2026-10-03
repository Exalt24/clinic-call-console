import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

/** A tiny signal-backed notification queue, rendered in an aria-live region by the shell. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly items = signal<Toast[]>([]);
  readonly toasts = this.items.asReadonly();

  info(text: string): void {
    this.push('info', text);
  }
  success(text: string): void {
    this.push('success', text);
  }
  error(text: string): void {
    this.push('error', text);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: Toast['kind'], text: string): void {
    // the same message twice in a row is one toast, so a retry storm cannot bury the screen
    if (this.items().some((t) => t.text === text)) return;
    const id = ++this.seq;
    this.items.update((list) => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 8000 : 4500);
  }
}
