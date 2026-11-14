import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_FILE_NAME, STATE_VERSION } from './constants.js';
import type { SourceBook } from './sources/types.js';

const FIRST_STATE_VERSION = 1;

export interface BookState {
  book: SourceBook | null;
  placed: boolean;
  lastFraction: number | null;
  lastSentAt: number | null;
  finishedSent: boolean;
  finishPending: boolean;
  finishedInSource: boolean;
  readingSent: boolean;
  listenedSinceFinish: Record<string, number>;
  days: Record<string, Record<string, number>>;
  dirtyDays: string[];
}

export interface SourceCursor {
  progress: number;
  sittings: number;
}

export interface SourceAccess {
  url: string;
  token: string;
  refreshToken: string | null;
}

export interface Listener {
  id: string;
  name: string | null;
  source: SourceAccess;
  signedOut: boolean;
  deviceKey: string | null;
  pairedAt: number | null;
  cursors: Record<string, SourceCursor>;
  books: Record<string, BookState>;
}

export interface State {
  version: number;
  listeners: Listener[];
}

interface FirstState {
  source?: SourceAccess | null;
  deviceKey?: string | null;
  pairedAt?: number | null;
  cursors?: Record<string, SourceCursor>;
  books?: Record<string, BookState>;
}

export function emptyState(): State {
  return { version: STATE_VERSION, listeners: [] };
}

export function newListener(source: SourceAccess, name: string | null): Listener {
  return { id: randomUUID(), name, source, signedOut: false, deviceKey: null, pairedAt: null, cursors: {}, books: {} };
}

export function newBook(book: SourceBook | null): BookState {
  return {
    book,
    placed: false,
    lastFraction: null,
    lastSentAt: null,
    finishedSent: false,
    finishPending: false,
    finishedInSource: false,
    readingSent: false,
    listenedSinceFinish: {},
    days: {},
    dirtyDays: [],
  };
}

export class StateStore {
  private readonly path: string;

  constructor(private readonly dataDir: string) {
    this.path = join(dataDir, STATE_FILE_NAME);
  }

  async load(): Promise<State> {
    let raw: string;

    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyState();
      }

      throw error;
    }

    const parsed = JSON.parse(raw) as { version?: number };

    if (parsed.version === FIRST_STATE_VERSION) {
      return fromFirstState(parsed as FirstState);
    }

    if (parsed.version !== STATE_VERSION) {
      throw new Error(`The saved state in ${this.path} was written by a different version of Seekquel Bridge.`);
    }

    const state = { ...emptyState(), ...(parsed as Partial<State>) };

    return {
      ...state,
      listeners: state.listeners.map((listener) => ({ ...listener, books: withCurrentFields(listener.books) })),
    };
  }

  async save(state: State): Promise<void> {
    const temporary = `${this.path}.tmp`;

    await mkdir(this.dataDir, { recursive: true });
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }
}

function fromFirstState(first: FirstState): State {
  if (first.source == null) {
    return emptyState();
  }

  return {
    version: STATE_VERSION,
    listeners: [
      {
        ...newListener(first.source, null),
        deviceKey: first.deviceKey ?? null,
        pairedAt: first.pairedAt ?? null,
        cursors: first.cursors ?? {},
        books: withCurrentFields(first.books ?? {}),
      },
    ],
  };
}

function withCurrentFields(books: Record<string, BookState>): Record<string, BookState> {
  return Object.fromEntries(Object.entries(books).map(([document, book]) => [document, { ...newBook(book.book), ...book }]));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
