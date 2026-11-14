import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyRefusedError, SeekquelClient } from '../src/seekquel.js';
import { AudiobookshelfSource } from '../src/sources/audiobookshelf.js';
import { newListener, type Listener } from '../src/state.js';
import { isWaiting, localDate, Syncer } from '../src/sync.js';

const ABS_URL = 'http://abs.test';
const SEEKQUEL_URL = 'http://seekquel.test/reading';
const PAIRED_AT = Date.parse('2026-11-14T08:00:00');
const AFTER_PAIRING = PAIRED_AT + 60_000;
const TODAY = localDate(PAIRED_AT);
const BOOK_ID = '0b9c1a52-6f0e-4c3e-9a55-3f6d6a1f2c11';
const DOCUMENT = `abs:${BOOK_ID}`;

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
}

interface World {
  progress: Record<string, unknown>[];
  sittings: Record<string, unknown>[];
  items: Record<string, Record<string, unknown>>;
  seekquelStatus: number;
  sent: Sent[];
}

function world(): World {
  return {
    progress: [],
    sittings: [],
    items: {
      [BOOK_ID]: {
        id: BOOK_ID,
        libraryId: 'lib-books',
        mediaType: 'book',
        media: {
          audioFiles: [{ duration: 36000 }],
          ebookFile: null,
          metadata: { title: 'The Listened Book', authors: [{ id: 'a1', name: 'A. Writer' }], isbn: '9780306406157', asin: 'B00TEST000' },
        },
      },
    },
    seekquelStatus: 200,
    sent: [],
  };
}

function fetcher(scene: World): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

    if (url.origin === ABS_URL) {
      if (url.pathname === '/api/me') {
        return answer(200, { mediaProgress: scene.progress });
      }

      if (url.pathname === '/api/me/listening-sessions') {
        return answer(200, { sessions: url.searchParams.get('page') === '0' ? scene.sittings : [] });
      }

      const item = scene.items[decodeURIComponent(url.pathname.replace('/api/items/', ''))];

      return item === undefined ? answer(404, {}) : answer(200, item);
    }

    if ((init?.method ?? 'GET') === 'GET') {
      return scene.seekquelStatus === 200
        ? answer(200, { match_status: 'matched', book: { status: 'reading' } })
        : answer(200, { match_status: 'unmatched', book: null });
    }

    scene.sent.push({
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/reading', ''),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });

    return scene.seekquelStatus === 200 || (scene.seekquelStatus === 409 && url.pathname.endsWith('/progress'))
      ? answer(200, {})
      : answer(scene.seekquelStatus, { error: { type: 'document_not_linked' } });
  };
}

function syncer(scene: World, now = AFTER_PAIRING): Syncer {
  const fetch = fetcher(scene);

  return new Syncer(
    new AudiobookshelfSource({ kind: 'audiobookshelf', url: ABS_URL, token: 'abs-token', refreshToken: null }, [], fetch, async () => undefined),
    new SeekquelClient(SEEKQUEL_URL, fetch),
    () => now,
  );
}

const STATUS_PATH = `/documents/${encodeURIComponent(DOCUMENT)}/status`;
const NEXT_DAY = AFTER_PAIRING + 86_400_000;

function calls(scene: World): string[] {
  return scene.sent.map((call) => `${call.method} ${call.path}`);
}

function paired(): Listener {
  return { ...newListener({ kind: 'audiobookshelf', url: ABS_URL, token: 'abs-token', refreshToken: null }, 'tester'), deviceKey: 'device-key', pairedAt: PAIRED_AT };
}

function listening(fraction: number, finished = false): Record<string, unknown> {
  return { libraryItemId: BOOK_ID, duration: 36000, progress: fraction, currentTime: fraction * 36000, isFinished: finished, lastUpdate: AFTER_PAIRING };
}

function sitting(id: string, seconds: number): Record<string, unknown> {
  return { id, libraryItemId: BOOK_ID, mediaType: 'book', date: TODAY, timeListening: seconds, updatedAt: AFTER_PAIRING };
}

test('a book listened to after pairing sends its place and the day total once', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.25)];
  scene.sittings = [sitting('s1', 600), sitting('s2', 300)];

  const report = await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', `PUT ${STATUS_PATH}`, 'POST /sessions']);
  assert.deepEqual(scene.sent[0]?.body.metadata, {
    title: 'The Listened Book',
    authors: 'A. Writer',
    format: 'audiobook',
    identifiers: 'isbn:9780306406157\nasin:B00TEST000',
    duration_seconds: 36000,
  });
  assert.equal(scene.sent[0]?.body.percentage, 0.25);
  assert.deepEqual(scene.sent[1]?.body, { status: 'reading' });
  assert.deepEqual(scene.sent[2]?.body, { document: DOCUMENT, days: [{ date: TODAY, seconds: 900 }] });
  assert.deepEqual(report, { placesSent: 1, readingSent: 1, daysSent: 1, finishesSent: 0 });

  scene.sent = [];
  await syncer(scene).run(state);

  assert.deepEqual(scene.sent, []);
});

test('time for a book Seekquel has not placed is kept and sent again later', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.1)];
  scene.sittings = [sitting('s1', 600)];
  scene.seekquelStatus = 409;

  await syncer(scene).run(state);

  const waiting = (): string[] => Object.values(state.books).filter((entry) => isWaiting(entry, TODAY)).map((entry) => entry.book?.title ?? '');

  assert.deepEqual(waiting(), ['The Listened Book']);

  scene.seekquelStatus = 200;
  scene.sent = [];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), [`PUT ${STATUS_PATH}`, 'POST /sessions']);
  assert.deepEqual(waiting(), []);
});

test('a book is marked as being read only after three minutes of listening, and its time waits until then', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.1)];
  scene.sittings = [sitting('s1', 120)];

  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress']);
  assert.deepEqual(Object.values(state.books).filter((entry) => isWaiting(entry, TODAY)), []);

  scene.sent = [];
  scene.sittings = [{ ...sitting('s1', 200), updatedAt: AFTER_PAIRING + 1000 }];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), [`PUT ${STATUS_PATH}`, 'POST /sessions']);
  assert.deepEqual(scene.sent[0]?.body, { status: 'reading' });
  assert.deepEqual(scene.sent[1]?.body, { document: DOCUMENT, days: [{ date: TODAY, seconds: 200 }] });
});

test('listening split across two days starts the read on the second day, before either day is sent', async () => {
  const scene = world();
  const state = paired();
  const tomorrow = localDate(NEXT_DAY);
  scene.progress = [listening(0.1)];
  scene.sittings = [sitting('s1', 120)];

  await syncer(scene).run(state);

  scene.sent = [];
  scene.sittings = [{ ...sitting('s2', 120), date: tomorrow, updatedAt: NEXT_DAY }];
  await syncer(scene, NEXT_DAY).run(state);

  assert.deepEqual(calls(scene), [`PUT ${STATUS_PATH}`, 'POST /sessions']);
  assert.deepEqual(scene.sent[1]?.body, { document: DOCUMENT, days: [{ date: TODAY, seconds: 120 }, { date: tomorrow, seconds: 120 }] });
});

test('a finish taken back in Audiobookshelf starts nothing, and finishing again is sent again', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.99, true)];

  await syncer(scene).run(state);

  scene.sent = [];
  scene.progress = [{ ...listening(0.99), lastUpdate: AFTER_PAIRING + 1000 }];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress']);

  scene.sent = [];
  scene.progress = [{ ...listening(0.99, true), lastUpdate: AFTER_PAIRING + 2000 }];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', `PUT ${STATUS_PATH}`]);
  assert.deepEqual(scene.sent[1]?.body, { status: 'read' });
});

test('a place Seekquel could not take is sent again on the next pass', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.3)];
  scene.seekquelStatus = 503;

  await assert.rejects(syncer(scene).run(state));

  scene.seekquelStatus = 200;
  scene.sent = [];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress']);
  assert.equal(scene.sent[0]?.body.percentage, 0.3);
});

test('a short listen starts nothing, and its time is still sent the next day', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.1)];
  scene.sittings = [sitting('s1', 60)];

  await syncer(scene).run(state);
  scene.sent = [];
  await syncer(scene, NEXT_DAY).run(state);

  assert.deepEqual(calls(scene), ['POST /sessions']);
  assert.deepEqual(scene.sent[0]?.body, { document: DOCUMENT, days: [{ date: TODAY, seconds: 60 }] });
});

test('a finished book is started again only by new listening after the finish', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.99, true)];
  scene.sittings = [sitting('s1', 600)];

  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', 'POST /sessions', `PUT ${STATUS_PATH}`]);
  assert.deepEqual(scene.sent[2]?.body, { status: 'read' });

  scene.sent = [];
  scene.progress = [{ ...listening(0.02), lastUpdate: AFTER_PAIRING + 1000 }];
  scene.sittings = [{ ...sitting('s2', 240), updatedAt: AFTER_PAIRING + 1000 }];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', `PUT ${STATUS_PATH}`, 'POST /sessions']);
  assert.deepEqual(scene.sent[1]?.body, { status: 'reading' });
});

test('a finished book is marked finished once, after its place', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.99, true)];

  await syncer(scene).run(state);
  await syncer(scene).run(state);

  assert.deepEqual(
    scene.sent.map((call) => `${call.method} ${call.path}`),
    ['PUT /progress', `PUT /documents/${encodeURIComponent(DOCUMENT)}/status`],
  );
  assert.equal(scene.sent[0]?.body.percentage, 1);
  assert.deepEqual(scene.sent[1]?.body, { status: 'read' });
});

test('an ebook is marked as being read once its place moves forward a little, and an audiobook skipped ahead is not', async () => {
  const scene = world();
  const state = paired();
  const ebook = (fraction: number, at: number): Record<string, unknown> => ({
    libraryItemId: 'ebook-1', duration: 0, progress: 0, ebookProgress: fraction, isFinished: false, lastUpdate: at,
  });
  scene.items['ebook-1'] = {
    id: 'ebook-1',
    libraryId: 'lib-books',
    mediaType: 'book',
    media: { audioFiles: [], ebookFile: { ebookFormat: 'epub' }, metadata: { title: 'The Read Book', authors: [] } },
  };
  scene.progress = [ebook(0.4, AFTER_PAIRING), { ...listening(0.4) }];

  await syncer(scene).run(state);

  scene.sent = [];
  scene.progress = [ebook(0.405, AFTER_PAIRING + 1000), { ...listening(0.6), lastUpdate: AFTER_PAIRING + 1000 }];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', 'PUT /progress']);

  scene.sent = [];
  scene.progress = [ebook(0.42, AFTER_PAIRING + 2000)];
  await syncer(scene).run(state);

  assert.deepEqual(calls(scene), ['PUT /progress', `PUT /documents/${encodeURIComponent('abs:ebook-1')}/status`]);
  assert.deepEqual(scene.sent[1]?.body, { status: 'reading' });
});

test('a book Seekquel is waiting on the reader to choose says so even when no time is sent', async () => {
  const scene = world();
  const state = paired();
  scene.progress = [listening(0.1)];
  scene.seekquelStatus = 409;

  await syncer(scene).run(state);
  await syncer(scene).run(state);

  assert.deepEqual(Object.values(state.books).map((entry) => isWaiting(entry, TODAY)), [true]);

  scene.seekquelStatus = 200;
  await syncer(scene).run(state);

  assert.deepEqual(Object.values(state.books).map((entry) => isWaiting(entry, TODAY)), [false]);
});

test('podcasts, other libraries and anything from before pairing are left alone', async () => {
  const scene = world();
  const state = paired();
  scene.items['podcast-1'] = { id: 'podcast-1', libraryId: 'lib-pods', mediaType: 'podcast', media: { metadata: { title: 'A Show' } } };
  scene.progress = [
    { ...listening(0.5), lastUpdate: PAIRED_AT - 1 },
    { ...listening(0.5), libraryItemId: 'podcast-1' },
    { ...listening(0.5), libraryItemId: 'podcast-1', episodeId: 'ep-1' },
  ];
  scene.sittings = [{ ...sitting('old', 900), updatedAt: PAIRED_AT - 1 }];

  await syncer(scene).run(state);

  assert.deepEqual(scene.sent, []);
});

test('a key Seekquel no longer accepts asks for pairing again', async () => {
  const scene = world();
  scene.progress = [listening(0.25)];
  scene.seekquelStatus = 401;

  await assert.rejects(syncer(scene).run(paired()), KeyRefusedError);
});
