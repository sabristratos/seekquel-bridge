import { asArray, asNumber, asString, field, HttpError, requestJson, type Fetch } from '../http.js';
import type { SourceAccess } from '../state.js';
import { SourceSignedOutError, type Source, type SourceBook, type SourceImage, type SourceProgress, type SourceSitting } from './types.js';

const SERVICE = 'Storyteller';
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const DEFAULT_IMAGE_TYPE = 'image/jpeg';
const FINISHED_FRACTION = 0.98;
const IDENTIFIER_PREFIXES: Readonly<Record<string, string>> = { 'isbn-13': 'isbn', isbn: 'isbn', asin: 'asin', audible: 'asin' };

export class StorytellerSource implements Source {
  readonly key = 'st';
  readonly name = SERVICE;

  private books = new Map<string, unknown>();

  constructor(
    private readonly access: SourceAccess,
    private readonly fetcher: Fetch,
  ) {}

  async progressSince(since: number): Promise<readonly SourceProgress[]> {
    const books = await this.list();

    return books
      .map((book) => progressOf(book))
      .filter((progress): progress is SourceProgress => progress !== null && progress.updatedAt >= since);
  }

  async sittingsSince(): Promise<readonly SourceSitting[]> {
    return [];
  }

  async book(id: string): Promise<SourceBook | null> {
    if (!this.books.has(id)) {
      await this.list();
    }

    const book = this.books.get(id);

    return book === undefined ? null : describe(id, book);
  }

  async cover(id: string): Promise<SourceImage | null> {
    let response: Response;

    try {
      response = await this.fetcher(`${this.access.url}/api/v2/books/${encodeURIComponent(id)}/cover`, {
        headers: { Authorization: `Bearer ${this.access.token}` },
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    return {
      type: response.headers.get('content-type') ?? DEFAULT_IMAGE_TYPE,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  private async list(): Promise<readonly unknown[]> {
    let answer: unknown;

    try {
      answer = await requestJson(this.fetcher, {
        service: SERVICE,
        method: 'GET',
        url: `${this.access.url}/api/v2/books`,
        token: this.access.token,
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === HTTP_UNAUTHORIZED) {
        throw new SourceSignedOutError('Storyteller no longer accepts this sign-in. Sign in again on the status page.');
      }

      if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
        return [];
      }

      throw error;
    }

    const books = asArray(answer);

    this.books = new Map(
      books.flatMap((book) => {
        const id = bookId(book);

        return id === null ? [] : [[id, book] as const];
      }),
    );

    return books;
  }
}

function bookId(book: unknown): string | null {
  return asString(field(book, 'uuid')) ?? asString(field(book, 'id'));
}

function progressOf(book: unknown): SourceProgress | null {
  const id = bookId(book);
  const position = field(book, 'position');
  const fraction = asNumber(field(field(field(position, 'locator'), 'locations'), 'totalProgression'));
  const updatedAt = serverTime(field(position, 'updatedAt')) ?? asNumber(field(position, 'timestamp'));

  if (id === null || fraction === null || updatedAt === null) {
    return null;
  }

  const place = Math.min(1, Math.max(0, fraction));
  const finished = place >= FINISHED_FRACTION;

  return { bookId: id, fraction: finished ? 1 : place, positionSeconds: null, finished, updatedAt };
}

function describe(id: string, book: unknown): SourceBook | null {
  const title = asString(field(book, 'title'));

  if (title === null) {
    return null;
  }

  const readable = field(book, 'ebook') != null || field(book, 'readaloud') != null;
  const audiobook = field(book, 'audiobook');

  return {
    id,
    title,
    authors: authorsOf(book),
    format: readable || audiobook == null ? 'epub' : 'audiobook',
    identifiers: identifiersOf(book),
    durationSeconds: readable ? null : asNumber(field(audiobook, 'duration')),
    hasCover: true,
  };
}

function authorsOf(book: unknown): string | null {
  const names = asArray(field(book, 'authors'))
    .map((author) => asString(field(author, 'name')) ?? asString(author))
    .filter((name): name is string => name !== null);

  return names.length === 0 ? null : names.join(', ');
}

function identifiersOf(book: unknown): string | null {
  const lines = asArray(field(book, 'identifiers')).flatMap((identifier) => {
    const prefix = IDENTIFIER_PREFIXES[asString(field(identifier, 'type'))?.toLowerCase() ?? ''];
    const value = asString(field(identifier, 'value'));

    return prefix === undefined || value === null ? [] : [`${prefix}:${value}`];
  });

  return lines.length === 0 ? null : [...new Set(lines)].join('\n');
}

function serverTime(value: unknown): number | null {
  const text = asString(value);

  if (text === null) {
    return null;
  }

  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);

  return Number.isNaN(parsed) ? null : parsed;
}
