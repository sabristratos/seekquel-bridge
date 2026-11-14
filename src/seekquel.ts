import { APP_NAME, APP_VERSION, DEVICE_IDENTIFIER, MAX_TEXT_LENGTH, SECONDS_PER_DAY } from './constants.js';
import { asNumber, asString, field, HttpError, requestJson, type Fetch } from './http.js';
import type { SourceBook } from './sources/types.js';

const SERVICE = 'Seekquel';
const HTTP_UNAUTHORIZED = 401;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY = 429;
const HTTP_FORBIDDEN = 403;
const PENDING_TYPE = 'authorization_pending';
const FINISHED_STATUS = 'read';

export interface PairingStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

export type PairingPoll =
  | { readonly outcome: 'approved'; readonly key: string }
  | { readonly outcome: 'pending' }
  | { readonly outcome: 'slow_down' }
  | { readonly outcome: 'ended' };

export interface DaySeconds {
  readonly date: string;
  readonly seconds: number;
}

export class KeyRefusedError extends Error {}

export class SeekquelClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetcher: Fetch,
  ) {}

  async startPairing(deviceName: string, platform: string): Promise<PairingStart> {
    const payload = await this.send('POST', '/pair/start', null, {
      device_name: deviceName,
      platform,
      app: APP_NAME,
    });
    const deviceCode = asString(field(payload, 'device_code'));
    const userCode = asString(field(payload, 'user_code'));
    const expiresInSeconds = asNumber(field(payload, 'expires_in'));
    const intervalSeconds = asNumber(field(payload, 'interval'));

    if (deviceCode === null || userCode === null || expiresInSeconds === null || intervalSeconds === null) {
      throw new Error('Seekquel answered the pairing request in a shape this version does not understand.');
    }

    return { deviceCode, userCode, expiresInSeconds, intervalSeconds };
  }

  async pollPairing(deviceCode: string): Promise<PairingPoll> {
    try {
      const payload = await this.send('POST', '/pair/poll', null, { device_code: deviceCode });
      const key = asString(field(payload, 'key'));

      return key === null ? { outcome: 'ended' } : { outcome: 'approved', key };
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }

      if (error.status === HTTP_TOO_MANY) {
        return { outcome: 'slow_down' };
      }

      if (error.errorType === PENDING_TYPE) {
        return { outcome: 'pending' };
      }

      if (error.status === HTTP_FORBIDDEN || error.status < 500) {
        return { outcome: 'ended' };
      }

      throw error;
    }
  }

  async pushPlace(key: string, document: string, book: SourceBook, fraction: number, positionSeconds: number | null): Promise<void> {
    await this.send('PUT', '/progress', key, {
      document,
      progress: String(Math.round(positionSeconds ?? 0)),
      percentage: fraction,
      device: APP_NAME,
      device_id: DEVICE_IDENTIFIER,
      metadata: {
        title: book.title.slice(0, MAX_TEXT_LENGTH),
        authors: book.authors?.slice(0, MAX_TEXT_LENGTH) ?? null,
        format: book.format,
        identifiers: book.identifiers,
        duration_seconds: book.durationSeconds,
      },
    });
  }

  async pushDays(key: string, document: string, days: readonly DaySeconds[]): Promise<boolean> {
    return this.unlessNotPlaced(() =>
      this.send('POST', '/sessions', key, {
        document,
        days: days.map((day) => ({ date: day.date, seconds: Math.min(SECONDS_PER_DAY, day.seconds) })),
      }),
    );
  }

  async markFinished(key: string, document: string): Promise<boolean> {
    return this.unlessNotPlaced(() =>
      this.send('PUT', `/documents/${encodeURIComponent(document)}/status`, key, { status: FINISHED_STATUS }),
    );
  }

  async describeDevice(key: string, deviceName: string, platform: string, lastSyncAt: number | null, lastSyncOk: boolean | null): Promise<void> {
    await this.send('PUT', '/device', key, {
      device_name: deviceName,
      platform,
      app_version: APP_VERSION,
      diagnostics: { last_sync_at: lastSyncAt, last_sync_ok: lastSyncOk },
    });
  }

  private async unlessNotPlaced(call: () => Promise<unknown>): Promise<boolean> {
    try {
      await call();

      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === HTTP_CONFLICT) {
        return false;
      }

      throw error;
    }
  }

  private async send(method: 'POST' | 'PUT', path: string, key: string | null, body: unknown): Promise<unknown> {
    try {
      return await requestJson(this.fetcher, {
        service: SERVICE,
        method,
        url: `${this.apiUrl}${path}`,
        body,
        ...(key === null ? {} : { token: key }),
      });
    } catch (error) {
      if (key !== null && error instanceof HttpError && error.status === HTTP_UNAUTHORIZED) {
        throw new KeyRefusedError('Seekquel no longer accepts this connection. Pair again.');
      }

      throw error;
    }
  }
}
