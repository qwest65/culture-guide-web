/**
 * Проигрыватель озвучки. На iPhone звук можно запустить только из нажатия, поэтому
 * кнопка «Начать прогулку» вызывает unlock(): один и тот же элемент <audio> после этого
 * играет и рассказы у объектов, которые запускаются сами по прибытии.
 */
const base = import.meta.env.BASE_URL;

/** Тишина 0,05 с (WAV) — чтобы разблокировать элемент нажатием. */
const SILENCE =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

type Listener = () => void;

class Player {
  readonly el: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio();
  /** Что играет сейчас (адрес) или null. */
  current: string | null = null;
  private queue: string[] = [];
  private listeners = new Set<Listener>();
  unlocked = false;

  constructor() {
    if (!this.el) return;
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => this.next());
  }

  /** Вызывать из обработчика нажатия. */
  unlock(): void {
    if (!this.el || this.unlocked) return;
    this.unlocked = true;
    this.el.src = SILENCE;
    this.el.play()?.catch(() => {
      this.unlocked = false;
    });
  }

  play(...urls: string[]): void {
    this.queue = urls.slice();
    this.next();
  }

  /** Добавить в очередь, не прерывая текущий рассказ. */
  enqueue(url: string): void {
    if (this.current) this.queue.push(url);
    else this.play(url);
  }

  stop(): void {
    this.queue = [];
    this.current = null;
    this.el?.pause();
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private next(): void {
    this.current = this.queue.shift() ?? null;
    this.emit();
    if (!this.el) return;
    if (!this.current) {
      this.el.pause();
      return;
    }
    this.el.src = /^(https?:|data:)/.test(this.current) ? this.current : base + this.current;
    this.el.play()?.catch(() => {
      this.queue = [];
      this.current = null;
      this.emit();
    });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const player = new Player();
