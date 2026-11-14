import { createHash } from 'node:crypto';
import { DAYS_KEPT, MAX_DOCUMENT_LENGTH, MIN_FRACTION_DELTA, MS_PER_DAY } from './constants.js';
import type { SeekquelClient } from './seekquel.js';
import type { Source } from './sources/types.js';
import { newBook, type BookState, type Listener, type SourceCursor } from './state.js';

const HASHED_ID_LENGTH = 48;

export interface SyncReport {
  readonly placesSent: number;
  readonly daysSent: number;
  readonly finishesSent: number;
}

export class NotPairedError extends Error {}

export class Syncer {
  constructor(
    private readonly source: Source,
    private readonly seekquel: SeekquelClient,
    private readonly now: () => number,
  ) {}

  async run(listener: Listener): Promise<SyncReport> {
    const key = listener.deviceKey;
    const pairedAt = listener.pairedAt;

    if (key === null || pairedAt === null) {
      throw new NotPairedError('This listener is not connected to Seekquel yet.');
    }

    const cursor = (listener.cursors[this.source.key] ??= { progress: pairedAt, sittings: pairedAt });
    const placesSent = await this.sendPlaces(listener, key, cursor);

    await this.collectSittings(listener, cursor);

    const daysSent = await this.sendDays(listener, key);
    const finishesSent = await this.sendFinishes(listener, key);

    this.forgetOldDays(listener);

    return { placesSent, daysSent, finishesSent };
  }

  private async sendPlaces(listener: Listener, key: string, cursor: SourceCursor): Promise<number> {
    const changes = [...(await this.source.progressSince(cursor.progress))].sort((a, b) => a.updatedAt - b.updatedAt);
    let sent = 0;

    for (const change of changes) {
      const document = this.document(change.bookId);
      const entry = await this.ensureBook(listener, document, change.bookId);

      if (entry.book !== null) {
        if (entry.lastFraction === null || Math.abs(entry.lastFraction - change.fraction) >= MIN_FRACTION_DELTA) {
          await this.seekquel.pushPlace(key, document, entry.book, change.fraction, change.positionSeconds);
          entry.lastFraction = change.fraction;
          entry.lastSentAt = this.now();
          sent++;
        }

        if (!change.finished) {
          entry.finishedSent = false;
          entry.finishPending = false;
        } else if (!entry.finishedSent) {
          entry.finishPending = true;
        }
      }

      cursor.progress = Math.max(cursor.progress, change.updatedAt);
    }

    return sent;
  }

  private async collectSittings(listener: Listener, cursor: SourceCursor): Promise<void> {
    for (const sitting of await this.source.sittingsSince(cursor.sittings)) {
      const entry = await this.ensureBook(listener, this.document(sitting.bookId), sitting.bookId);

      if (entry.book !== null) {
        (entry.days[sitting.date] ??= {})[sitting.sittingId] = sitting.seconds;

        if (!entry.dirtyDays.includes(sitting.date)) {
          entry.dirtyDays.push(sitting.date);
        }
      }

      cursor.sittings = Math.max(cursor.sittings, sitting.updatedAt);
    }
  }

  private async sendDays(listener: Listener, key: string): Promise<number> {
    let sent = 0;

    for (const [document, entry] of Object.entries(listener.books)) {
      if (entry.dirtyDays.length === 0 || entry.lastFraction === null) {
        continue;
      }

      const days = entry.dirtyDays.map((date) => ({ date, seconds: secondsOn(entry, date) }));

      entry.placed = await this.seekquel.pushDays(key, document, days);

      if (entry.placed) {
        sent += days.length;
        entry.dirtyDays = [];
        entry.lastSentAt = this.now();
      }
    }

    return sent;
  }

  private async sendFinishes(listener: Listener, key: string): Promise<number> {
    let sent = 0;

    for (const [document, entry] of Object.entries(listener.books)) {
      if (!entry.finishPending) {
        continue;
      }

      entry.placed = await this.seekquel.markFinished(key, document);

      if (entry.placed) {
        entry.finishPending = false;
        entry.finishedSent = true;
        entry.lastSentAt = this.now();
        sent++;
      }
    }

    return sent;
  }

  private async ensureBook(listener: Listener, document: string, bookId: string): Promise<BookState> {
    return (listener.books[document] ??= newBook(await this.source.book(bookId)));
  }

  private forgetOldDays(listener: Listener): void {
    const oldest = localDate(this.now() - DAYS_KEPT * MS_PER_DAY);

    for (const entry of Object.values(listener.books)) {
      for (const date of Object.keys(entry.days)) {
        if (date < oldest && !entry.dirtyDays.includes(date)) {
          delete entry.days[date];
        }
      }
    }
  }

  private document(bookId: string): string {
    const plain = `${this.source.key}:${bookId}`;

    if (plain.length <= MAX_DOCUMENT_LENGTH) {
      return plain;
    }

    return `${this.source.key}:${createHash('sha256').update(bookId).digest('hex').slice(0, HASHED_ID_LENGTH)}`;
  }
}

export function isWaiting(entry: BookState): boolean {
  return entry.book !== null && !entry.placed && (entry.dirtyDays.length > 0 || entry.finishPending);
}

export function secondsOn(entry: BookState, date: string): number {
  return Object.values(entry.days[date] ?? {}).reduce((sum, seconds) => sum + seconds, 0);
}

export function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}
