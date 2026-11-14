import { setTimeout as sleep } from 'node:timers/promises';
import { ConfigError, loadConfig, type Config } from './config.js';
import { APP_NAME, APP_VERSION, MS_PER_SECOND, TICK_SECONDS, WAITING_BOOKS_PATH } from './constants.js';
import type { BookView, ListenerView, PageModel } from './page.js';
import { ListenerRunner } from './runner.js';
import { SeekquelClient } from './seekquel.js';
import { startServer, type BridgeActions, type SignInAnswer } from './server.js';
import { findServer, isAudiobookshelf, signIn, SignInRefusedError, USUAL_ADDRESSES } from './sources/audiobookshelfAccess.js';
import type { SourceImage } from './sources/types.js';
import { newListener, StateStore, type BookState, type Listener, type State } from './state.js';
import { isWaiting, localDate, secondsOn } from './sync.js';

const EXIT_BAD_CONFIG = 78;
const PERCENT = 100;

class Bridge implements BridgeActions {
  private readonly seekquel: SeekquelClient;
  private readonly runners = new Map<string, ListenerRunner>();
  private readonly stop = new AbortController();
  private foundAddress: string | null;
  private formProblem: PageModel['formProblem'] = null;

  constructor(
    private readonly config: Config,
    private readonly store: StateStore,
    private readonly state: State,
  ) {
    this.seekquel = new SeekquelClient(config.seekquelApiUrl, fetch);
    this.foundAddress = config.audiobookshelf.url;
  }

  async run(): Promise<void> {
    await this.adoptConfiguredListener();

    for (const listener of this.state.listeners) {
      this.runners.set(listener.id, this.runnerFor(listener));
    }

    const server = startServer(this, this.config.statusPort);

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => this.stop.abort());
    }

    log(`${APP_NAME} ${APP_VERSION} started. Open the page on port ${this.config.statusPort}.`);

    if (this.foundAddress === null) {
      void findServer(fetch, USUAL_ADDRESSES).then((address) => {
        this.foundAddress ??= address;
      });
    }

    while (!this.stop.signal.aborted) {
      for (const runner of [...this.runners.values()]) {
        await runner.tick();
      }

      await sleep(TICK_SECONDS * MS_PER_SECOND, undefined, { signal: this.stop.signal }).catch(() => undefined);
    }

    for (const runner of this.runners.values()) {
      runner.stop();
    }

    server.close();
    log(`${APP_NAME} stopped.`);
  }

  page(): PageModel {
    const now = Date.now();
    const formProblem = this.formProblem;

    this.formProblem = null;

    return {
      now,
      foundAddress: this.foundAddress,
      formProblem,
      waitingBooksLink: `${this.config.seekquelAppUrl}${WAITING_BOOKS_PATH}`,
      listeners: [...this.runners.values()].map((runner) => this.view(runner, now)),
    };
  }

  health(): Record<string, unknown> {
    const runners = [...this.runners.values()];
    const today = localDate(Date.now());

    return {
      listeners: runners.length,
      connected: runners.filter((runner) => runner.listener.deviceKey !== null && !runner.listener.signedOut).length,
      last_sync_ok: runners.every((runner) => runner.lastSyncOk !== false),
      waiting: runners.reduce((sum, runner) => sum + Object.values(runner.listener.books).filter((entry) => isWaiting(entry, today)).length, 0),
    };
  }

  async signIn(answer: SignInAnswer): Promise<void> {
    const address = normalizeAddress(answer.address);

    try {
      if (address === null || !(await isAudiobookshelf(fetch, address))) {
        this.formProblem = { address: answer.address, message: 'No Audiobookshelf answered at that address.' };

        return;
      }

      const signedIn = await signIn(fetch, address, answer.username, answer.password);
      const existing = this.state.listeners.find(
        (listener) => listener.source.url === address && listener.name === signedIn.name,
      );

      if (existing === undefined) {
        const listener = newListener(signedIn.access, signedIn.name);

        this.state.listeners.push(listener);
        this.runners.set(listener.id, this.runnerFor(listener));
      } else {
        existing.source.token = signedIn.access.token;
        existing.source.refreshToken = signedIn.access.refreshToken;
        existing.signedOut = false;
        this.runners.get(existing.id)?.checkNow();
      }

      await this.store.save(this.state);
      this.formProblem = null;
      log(`${signedIn.name ?? 'A listener'} signed in to Audiobookshelf.`);
    } catch (error) {
      this.formProblem = {
        address: answer.address,
        message: error instanceof SignInRefusedError ? error.message : 'Audiobookshelf could not be reached. Try again.',
      };
    }
  }

  checkNow(listenerId: string): void {
    this.runners.get(listenerId)?.checkNow();
  }

  async disconnect(listenerId: string): Promise<void> {
    this.runners.get(listenerId)?.stop();
    this.runners.delete(listenerId);
    this.state.listeners = this.state.listeners.filter((listener) => listener.id !== listenerId);
    await this.store.save(this.state);
  }

  cover(listenerId: string, document: string): Promise<SourceImage | null> {
    return this.runners.get(listenerId)?.cover(document) ?? Promise.resolve(null);
  }

  private async adoptConfiguredListener(): Promise<void> {
    const { url, token } = this.config.audiobookshelf;

    if (this.state.listeners.length > 0 || url === null || token === null) {
      return;
    }

    this.state.listeners.push(newListener({ url, token, refreshToken: null }, null));
    await this.store.save(this.state);
  }

  private runnerFor(listener: Listener): ListenerRunner {
    return new ListenerRunner(listener, {
      config: this.config,
      seekquel: this.seekquel,
      fetcher: fetch,
      now: Date.now,
      save: () => this.store.save(this.state),
      log,
    });
  }

  private view(runner: ListenerRunner, now: number): ListenerView {
    const { listener } = runner;
    const today = localDate(now);

    return {
      id: listener.id,
      name: listener.name,
      sourceName: runner.sourceName,
      address: listener.source.url,
      state: listener.signedOut ? 'signed-out' : listener.deviceKey === null ? 'pairing' : 'connected',
      pairing: runner.pairing,
      lastSyncAt: runner.lastSyncAt,
      problem: runner.problem,
      books: Object.entries(listener.books)
        .filter(([, entry]) => entry.book !== null)
        .sort(([, a], [, b]) => (b.lastSentAt ?? 0) - (a.lastSentAt ?? 0))
        .map(([document, entry]) => bookView(document, entry, today)),
    };
  }
}

function bookView(document: string, entry: BookState, today: string): BookView {
  return {
    document,
    title: entry.book?.title ?? '',
    authors: entry.book?.authors ?? null,
    hasCover: entry.book?.hasCover ?? false,
    secondsToday: secondsOn(entry, today),
    percent: entry.lastFraction === null ? null : Math.round(entry.lastFraction * PERCENT),
    finished: entry.finishedSent || entry.finishPending,
    waiting: isWaiting(entry, today),
    lastSentAt: entry.lastSentAt,
  };
}

function normalizeAddress(value: string): string | null {
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;

  try {
    const parsed = new URL(withScheme);

    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      log(error.message);
      process.exit(EXIT_BAD_CONFIG);
    }

    throw error;
  }
}

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

const config = readConfig();
const store = new StateStore(config.dataDir);

await new Bridge(config, store, await store.load()).run();
