import { MS_PER_DAY } from '../constants.js';
import { asArray, asNumber, asString, field, HttpError, requestJson, type Fetch } from '../http.js';
import type { SourceAccess } from '../state.js';
import { renew } from './audiobookshelfAccess.js';
import type { Source, SourceBook, SourceImage, SourceProgress, SourceSitting } from './types.js';

const SERVICE = 'Audiobookshelf';
const SITTINGS_PER_PAGE = 100;
const MAX_SITTING_PAGES = 20;
const SITTING_LOOKBACK_MS = 2 * MS_PER_DAY;
const BOOK_MEDIA_TYPE = 'book';
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const DEFAULT_IMAGE_TYPE = 'image/jpeg';
const COVER_WIDTH = 240;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class SourceSignedOutError extends Error {}

export class AudiobookshelfSource implements Source {
  readonly key = 'abs';
  readonly name = SERVICE;

  constructor(
    private readonly access: SourceAccess,
    private readonly libraries: readonly string[],
    private readonly fetcher: Fetch,
    private readonly remember: (access: SourceAccess) => Promise<void>,
  ) {}

  async progressSince(since: number): Promise<readonly SourceProgress[]> {
    const me = await this.get('/api/me');

    return asArray(field(me, 'mediaProgress'))
      .map((entry) => this.progress(entry))
      .filter((entry): entry is SourceProgress => entry !== null && entry.updatedAt > since);
  }

  async sittingsSince(since: number): Promise<readonly SourceSitting[]> {
    const sittings: SourceSitting[] = [];
    const horizon = since - SITTING_LOOKBACK_MS;

    for (let page = 0; page < MAX_SITTING_PAGES; page++) {
      const payload = await this.get(`/api/me/listening-sessions?itemsPerPage=${SITTINGS_PER_PAGE}&page=${page}`);
      const entries = asArray(field(payload, 'sessions'));
      let newest = 0;

      for (const entry of entries) {
        const sitting = this.sitting(entry);
        newest = Math.max(newest, asNumber(field(entry, 'updatedAt')) ?? 0);

        if (sitting !== null && sitting.updatedAt > since) {
          sittings.push(sitting);
        }
      }

      if (entries.length < SITTINGS_PER_PAGE || newest < horizon) {
        break;
      }
    }

    return sittings;
  }

  async book(id: string): Promise<SourceBook | null> {
    const item = await this.get(`/api/items/${encodeURIComponent(id)}`);
    const libraryId = asString(field(item, 'libraryId'));

    if (asString(field(item, 'mediaType')) !== BOOK_MEDIA_TYPE) {
      return null;
    }

    if (this.libraries.length > 0 && (libraryId === null || !this.libraries.includes(libraryId))) {
      return null;
    }

    const media = field(item, 'media');
    const metadata = field(media, 'metadata');
    const title = asString(field(metadata, 'title'));

    if (title === null) {
      return null;
    }

    return {
      id,
      title,
      authors: authorNames(metadata),
      format: asArray(field(media, 'audioFiles')).length > 0 || (asNumber(field(media, 'duration')) ?? 0) > 0 ? 'audiobook' : 'epub',
      identifiers: identifiers(asString(field(metadata, 'isbn')), asString(field(metadata, 'asin'))),
      durationSeconds: duration(media),
      hasCover: asString(field(media, 'coverPath')) !== null,
    };
  }

  async cover(id: string): Promise<SourceImage | null> {
    const response = await this.fetcher(`${this.access.url}/api/items/${encodeURIComponent(id)}/cover?width=${COVER_WIDTH}`, {
      headers: { Authorization: `Bearer ${this.access.token}` },
    });

    if (response.status === HTTP_NOT_FOUND || !response.ok) {
      return null;
    }

    return {
      type: response.headers.get('content-type') ?? DEFAULT_IMAGE_TYPE,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  private progress(entry: unknown): SourceProgress | null {
    const bookId = asString(field(entry, 'libraryItemId'));
    const updatedAt = asNumber(field(entry, 'lastUpdate'));

    if (bookId === null || updatedAt === null || asString(field(entry, 'episodeId')) !== null) {
      return null;
    }

    const listens = (asNumber(field(entry, 'duration')) ?? 0) > 0;
    const fraction = listens ? asNumber(field(entry, 'progress')) : asNumber(field(entry, 'ebookProgress'));
    const finished = field(entry, 'isFinished') === true;

    return {
      bookId,
      fraction: finished ? 1 : clamp(fraction ?? 0),
      positionSeconds: listens ? asNumber(field(entry, 'currentTime')) : null,
      finished,
      updatedAt,
    };
  }

  private sitting(entry: unknown): SourceSitting | null {
    const bookId = asString(field(entry, 'libraryItemId'));
    const sittingId = asString(field(entry, 'id'));
    const date = asString(field(entry, 'date'));
    const seconds = asNumber(field(entry, 'timeListening'));
    const updatedAt = asNumber(field(entry, 'updatedAt'));

    if (
      bookId === null ||
      sittingId === null ||
      date === null ||
      !DATE_PATTERN.test(date) ||
      seconds === null ||
      updatedAt === null ||
      asString(field(entry, 'mediaType')) !== BOOK_MEDIA_TYPE
    ) {
      return null;
    }

    return { bookId, sittingId, date, seconds: Math.max(0, Math.round(seconds)), updatedAt };
  }

  private async get(path: string): Promise<unknown> {
    try {
      return await this.ask(path);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== HTTP_UNAUTHORIZED) {
        throw error;
      }
    }

    const renewed = await renew(this.fetcher, this.access);

    if (renewed === null) {
      throw new SourceSignedOutError('Audiobookshelf no longer accepts this sign-in. Sign in again on the status page.');
    }

    this.access.token = renewed.token;
    this.access.refreshToken = renewed.refreshToken;
    await this.remember(this.access);

    return this.ask(path);
  }

  private ask(path: string): Promise<unknown> {
    return requestJson(this.fetcher, {
      service: SERVICE,
      method: 'GET',
      url: `${this.access.url}${path}`,
      token: this.access.token,
    });
  }
}

function duration(media: unknown): number | null {
  const whole = asNumber(field(media, 'duration'));
  const files = asArray(field(media, 'audioFiles')).reduce<number>((sum, file) => sum + (asNumber(field(file, 'duration')) ?? 0), 0);
  const seconds = Math.round(whole ?? files);

  return seconds > 0 ? seconds : null;
}

function authorNames(metadata: unknown): string | null {
  const names = asArray(field(metadata, 'authors'))
    .map((author) => asString(field(author, 'name')))
    .filter((name): name is string => name !== null);

  return names.length === 0 ? asString(field(metadata, 'authorName')) : names.join(', ');
}

function identifiers(isbn: string | null, asin: string | null): string | null {
  const parts = [isbn === null ? null : `isbn:${isbn}`, asin === null ? null : `asin:${asin}`].filter(
    (part): part is string => part !== null,
  );

  return parts.length === 0 ? null : parts.join('\n');
}

function clamp(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}
