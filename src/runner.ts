import type { Config } from './config.js';
import {
  MAX_BACKOFF_SECONDS,
  MIN_SECONDS_BETWEEN_NUDGED_SYNCS,
  MS_PER_SECOND,
  NUDGE_DELAY_SECONDS,
  PAIRING_LINK_PATH,
  PAIRING_SLOW_DOWN_SECONDS,
} from './constants.js';
import type { Fetch } from './http.js';
import { explain } from './problems.js';
import { KeyRefusedError, type SeekquelClient } from './seekquel.js';
import { AudiobookshelfSource, SourceSignedOutError } from './sources/audiobookshelf.js';
import { AudiobookshelfLive } from './sources/audiobookshelfLive.js';
import type { SourceImage } from './sources/types.js';
import type { Listener } from './state.js';
import { Syncer } from './sync.js';

const MAX_BACKOFF_DOUBLINGS = 10;
const PAIRING_RETRY_SECONDS = 30;

export interface PairingNotice {
  readonly userCode: string;
  readonly link: string;
  readonly expiresAt: number;
}

interface PairingInProgress extends PairingNotice {
  readonly deviceCode: string;
  intervalSeconds: number;
  nextPollAt: number;
}

export interface RunnerDeps {
  readonly config: Config;
  readonly seekquel: SeekquelClient;
  readonly fetcher: Fetch;
  readonly now: () => number;
  readonly save: () => Promise<void>;
  readonly log: (line: string) => void;
}

export class ListenerRunner {
  lastSyncAt: number | null = null;
  lastSyncOk: boolean | null = null;
  problem: string | null = null;

  private readonly source: AudiobookshelfSource;
  private readonly syncer: Syncer;
  private readonly live: AudiobookshelfLive;
  private pairingState: PairingInProgress | null = null;
  private nextSyncAt = 0;
  private nextPairingAt = 0;
  private failures = 0;

  constructor(
    readonly listener: Listener,
    private readonly deps: RunnerDeps,
  ) {
    this.source = new AudiobookshelfSource(listener.source, deps.config.audiobookshelf.libraries, deps.fetcher, deps.save);
    this.syncer = new Syncer(this.source, deps.seekquel, deps.now);
    this.live = new AudiobookshelfLive(listener.source, () => this.nudge());
  }

  get sourceName(): string {
    return this.source.name;
  }

  get pairing(): PairingNotice | null {
    return this.pairingState;
  }

  async tick(): Promise<void> {
    if (this.listener.signedOut) {
      return;
    }

    try {
      if (this.listener.deviceKey === null) {
        await this.pair();
      } else if (this.deps.now() >= this.nextSyncAt) {
        await this.sync(this.listener.deviceKey);
      }
    } catch (error) {
      await this.recover(error);
    }
  }

  checkNow(): void {
    this.failures = 0;
    this.nextSyncAt = 0;
    this.nextPairingAt = 0;
  }

  stop(): void {
    this.live.stop();
  }

  cover(document: string): Promise<SourceImage | null> {
    const book = this.listener.books[document]?.book;

    return book == null ? Promise.resolve(null) : this.source.cover(book.id);
  }

  private nudge(): void {
    const soonest = Math.max(
      this.deps.now() + NUDGE_DELAY_SECONDS * MS_PER_SECOND,
      (this.lastSyncAt ?? 0) + MIN_SECONDS_BETWEEN_NUDGED_SYNCS * MS_PER_SECOND,
    );

    this.nextSyncAt = Math.min(this.nextSyncAt, soonest);
  }

  private async sync(key: string): Promise<void> {
    const report = await this.syncer.run(this.listener);
    const now = this.deps.now();

    await this.deps.save();

    this.lastSyncAt = now;
    this.lastSyncOk = true;
    this.problem = null;
    this.failures = 0;
    this.nextSyncAt = now + this.deps.config.pollSeconds * MS_PER_SECOND;
    this.live.start();

    if (report.placesSent + report.daysSent + report.finishesSent > 0) {
      this.deps.log(
        `${this.label()}: sent ${report.placesSent} places, ${report.daysSent} days of time and ${report.finishesSent} finished books.`,
      );
    }

    await this.deps.seekquel
      .describeDevice(key, this.deps.config.deviceName, this.source.name, now, true)
      .catch(() => undefined);
  }

  private async pair(): Promise<void> {
    const now = this.deps.now();

    if (this.pairingState === null || now >= this.pairingState.expiresAt) {
      if (now < this.nextPairingAt) {
        return;
      }

      const started = await this.deps.seekquel.startPairing(this.deps.config.deviceName, this.source.name);
      const link = `${this.deps.config.seekquelAppUrl}${PAIRING_LINK_PATH}?code=${encodeURIComponent(started.userCode.replaceAll('-', ''))}`;

      this.pairingState = {
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        link,
        expiresAt: now + started.expiresInSeconds * MS_PER_SECOND,
        intervalSeconds: started.intervalSeconds,
        nextPollAt: now + started.intervalSeconds * MS_PER_SECOND,
      };
      this.problem = null;
      this.deps.log(`${this.label()}: to connect, open ${link} or enter the code ${started.userCode} in Seekquel.`);

      return;
    }

    if (now < this.pairingState.nextPollAt) {
      return;
    }

    const answer = await this.deps.seekquel.pollPairing(this.pairingState.deviceCode);

    if (answer.outcome === 'approved') {
      this.listener.deviceKey = answer.key;
      this.listener.pairedAt ??= now;
      this.pairingState = null;
      this.nextSyncAt = 0;
      await this.deps.save();
      this.deps.log(`${this.label()}: connected to Seekquel.`);

      return;
    }

    if (answer.outcome === 'ended') {
      this.pairingState = null;

      return;
    }

    if (answer.outcome === 'slow_down') {
      this.pairingState.intervalSeconds += PAIRING_SLOW_DOWN_SECONDS;
    }

    this.pairingState.nextPollAt = now + this.pairingState.intervalSeconds * MS_PER_SECOND;
  }

  private async recover(error: unknown): Promise<void> {
    const now = this.deps.now();

    if (error instanceof KeyRefusedError) {
      this.listener.deviceKey = null;
      this.pairingState = null;
    } else if (error instanceof SourceSignedOutError) {
      this.listener.signedOut = true;
      this.live.stop();
    } else {
      this.failures++;
    }

    await this.deps.save().catch(() => undefined);

    this.problem = explain(error);
    this.lastSyncOk = this.listener.deviceKey === null ? this.lastSyncOk : false;
    this.nextSyncAt =
      now +
      Math.min(MAX_BACKOFF_SECONDS, this.deps.config.pollSeconds * 2 ** Math.min(this.failures, MAX_BACKOFF_DOUBLINGS)) * MS_PER_SECOND;
    this.nextPairingAt = now + PAIRING_RETRY_SECONDS * MS_PER_SECOND;

    if (this.pairingState !== null) {
      this.pairingState.nextPollAt = this.nextPairingAt;
    }

    this.deps.log(`${this.label()}: ${error instanceof Error ? error.message : String(error)}`);
  }

  private label(): string {
    return this.listener.name ?? this.source.name;
  }
}
