import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnreachableError } from '../src/http.js';
import { SeekquelClient } from '../src/seekquel.js';
import { StorytellerSource } from '../src/sources/storyteller.js';
import { isStoryteller, signInToStoryteller } from '../src/sources/storytellerAccess.js';
import { SignInRefusedError, SourceSignedOutError } from '../src/sources/types.js';
import { newListener, type Listener } from '../src/state.js';
import { Syncer } from '../src/sync.js';

const URL_HOME = 'http://storyteller.test';
const BOOK_UUID = '7db6d6a9-5ab4-4681-9ddf-d65b5b5fdee7';
const READ_AT = Date.parse('2026-11-14T17:35:29Z');

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function book(totalProgression: number | null, status = 'Reading'): Record<string, unknown> {
  return {
    uuid: BOOK_UUID,
    title: 'Frankenstein',
    authors: [{ name: 'Mary Shelley' }],
    identifiers: [{ type: 'isbn-13', value: '9780141439471' }],
    status: { name: status },
    position:
      totalProgression === null
        ? null
        : { locator: { href: 'c3.xhtml', locations: { progression: 0.4, totalProgression } }, timestamp: READ_AT },
    ebook: { uuid: 'ebook-1' },
    audiobook: null,
    readaloud: null,
  };
}

test('a Storyteller server is told apart by its health check and its greeting', async () => {
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;

    return path === '/api/health' ? answer(200, { status: 'healthy' }) : answer(200, { Hello: 'World' });
  };
  const elsewhere: typeof fetch = async () => answer(200, { app: 'audiobookshelf' });

  assert.equal(await isStoryteller(fetcher, URL_HOME), true);
  assert.equal(await isStoryteller(elsewhere, URL_HOME), false);
});

test('signing in to Storyteller by email sends a form, keeps the token and names the account by its username', async () => {
  let sent = '';
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === '/api/v2/user') {
      return answer(200, { username: 'tester', email: 'tester@example.test' });
    }

    sent = String(init?.body);

    return new URLSearchParams(sent).get('password') === 'right'
      ? answer(200, { access_token: 'token-1', expires_in: 1, token_type: 'bearer' })
      : answer(401, {});
  };

  const signedIn = await signInToStoryteller(fetcher, URL_HOME, 'tester@example.test', 'right');

  assert.equal(new URLSearchParams(sent).get('usernameOrEmail'), 'tester@example.test');
  assert.equal(signedIn.name, 'tester');
  assert.deepEqual(signedIn.access, { kind: 'storyteller', url: URL_HOME, token: 'token-1', refreshToken: null });
  await assert.rejects(signInToStoryteller(fetcher, URL_HOME, 'tester', 'wrong'), SignInRefusedError);
});

test('a book read in Storyteller gives its place, its identifiers, a finish at 98% and a re-read under a stale Read', async () => {
  let books = [book(0.21), { ...book(null), uuid: 'unread' }];
  const fetcher: typeof fetch = async () => answer(200, books);
  const source = new StorytellerSource({ kind: 'storyteller', url: URL_HOME, token: 'token-1', refreshToken: null }, fetcher);

  assert.deepEqual(await source.progressSince(0), [
    { bookId: BOOK_UUID, fraction: 0.21, positionSeconds: null, finished: false, updatedAt: READ_AT },
  ]);
  assert.deepEqual(await source.progressSince(READ_AT + 1), []);
  assert.deepEqual(await source.sittingsSince(), []);
  assert.deepEqual(await source.book(BOOK_UUID), {
    id: BOOK_UUID,
    title: 'Frankenstein',
    authors: 'Mary Shelley',
    format: 'epub',
    identifiers: 'isbn:9780141439471',
    durationSeconds: null,
    hasCover: true,
  });

  books = [book(0.99, 'Read')];

  assert.equal((await source.progressSince(0))[0]?.finished, true);
  assert.equal((await source.progressSince(0))[0]?.fraction, 1);

  books = [book(0.08, 'Read')];

  assert.deepEqual((await source.progressSince(0))[0], {
    bookId: BOOK_UUID, fraction: 0.08, positionSeconds: null, finished: false, updatedAt: READ_AT,
  });
});

test('a Storyteller sign-in that has run out asks the reader to sign in again', async () => {
  const source = new StorytellerSource(
    { kind: 'storyteller', url: URL_HOME, token: 'old', refreshToken: null },
    async () => answer(401, {}),
  );

  await assert.rejects(source.progressSince(0), SourceSignedOutError);
});

const PAIRED_AT = Date.parse('2026-11-14T08:00:00Z');
const SEEKQUEL_URL = 'http://seekquel.test/reading';
const DOCUMENT = `st:${BOOK_UUID}`;
const STATUS_PATH = `/documents/${encodeURIComponent(DOCUMENT)}/status`;

interface Scene {
  books: Record<string, unknown>[];
  sent: string[];
  bodies: unknown[];
}

function placed(totalProgression: number, at: number, status = 'Reading'): Record<string, unknown> {
  return {
    ...book(totalProgression, status),
    position: {
      locator: { locations: { totalProgression } },
      timestamp: at,
      updatedAt: new Date(at).toISOString().replace('T', ' ').slice(0, 19),
    },
  };
}

function run(scene: Scene, now: number, listener: Listener): Promise<unknown> {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));

    if (url.origin === URL_HOME) {
      return answer(200, scene.books);
    }

    if ((init?.method ?? 'GET') === 'GET') {
      return answer(200, { match_status: 'matched', book: { status: 'reading' } });
    }

    scene.sent.push(`${init?.method} ${url.pathname.replace('/reading', '')}`);
    scene.bodies.push(JSON.parse(String(init?.body ?? '{}')));

    return answer(200, {});
  };

  return new Syncer(
    new StorytellerSource({ kind: 'storyteller', url: URL_HOME, token: 'token-1', refreshToken: null }, fetcher),
    new SeekquelClient(SEEKQUEL_URL, fetcher),
    () => now,
  ).run(listener);
}

function pairedListener(): Listener {
  return {
    ...newListener({ kind: 'storyteller', url: URL_HOME, token: 'token-1', refreshToken: null }, 'tester'),
    deviceKey: 'device-key',
    pairedAt: PAIRED_AT,
  };
}

test('a Storyteller time with no zone is read as UTC, and the server clock wins over a device clock that is behind', async () => {
  const deviceBehind = PAIRED_AT - 86_400_000;
  const books = [{ ...book(0.3), position: { locator: { locations: { totalProgression: 0.3 } }, timestamp: deviceBehind, updatedAt: '2026-11-14 09:00:00' } }];
  const source = new StorytellerSource({ kind: 'storyteller', url: URL_HOME, token: 't', refreshToken: null }, async () => answer(200, books));

  assert.deepEqual((await source.progressSince(PAIRED_AT)).map((progress) => progress.updatedAt), [Date.parse('2026-11-14T09:00:00Z')]);
});

test('a Storyteller book with nothing read, or read only before pairing, sends nothing', async () => {
  const scene: Scene = { books: [book(null, 'To read'), { ...placed(0.5, PAIRED_AT - 60_000), uuid: 'before' }], sent: [], bodies: [] };

  await run(scene, PAIRED_AT + 60_000, pairedListener());

  assert.deepEqual(scene.sent, []);
});

test('a Storyteller book is finished at 98%, and read again from the start under a stale Read it opens a new read', async () => {
  const scene: Scene = { books: [placed(0.4, PAIRED_AT + 1000)], sent: [], bodies: [] };
  const listener = pairedListener();

  await run(scene, PAIRED_AT + 2000, listener);
  scene.books = [placed(0.98, PAIRED_AT + 3000, 'Read')];
  await run(scene, PAIRED_AT + 4000, listener);

  assert.deepEqual(scene.sent, ['PUT /progress', 'PUT /progress', `PUT ${STATUS_PATH}`]);
  assert.deepEqual(scene.bodies[2], { status: 'read' });

  scene.sent = [];
  scene.bodies = [];
  scene.books = [placed(0.02, PAIRED_AT + 5000, 'Read')];
  await run(scene, PAIRED_AT + 6000, listener);
  scene.books = [placed(0.025, PAIRED_AT + 7000, 'Read')];
  await run(scene, PAIRED_AT + 8000, listener);

  assert.deepEqual(scene.sent, ['PUT /progress', 'PUT /progress']);

  scene.books = [placed(0.04, PAIRED_AT + 9000, 'Read')];
  await run(scene, PAIRED_AT + 10_000, listener);

  assert.deepEqual(scene.sent.slice(-2), ['PUT /progress', `PUT ${STATUS_PATH}`]);
  assert.deepEqual(scene.bodies.at(-1), { status: 'reading' });
});

test('the same Storyteller place seen twice is sent once', async () => {
  const scene: Scene = { books: [placed(0.4, PAIRED_AT + 1000)], sent: [], bodies: [] };
  const listener = pairedListener();

  await run(scene, PAIRED_AT + 2000, listener);
  await run(scene, PAIRED_AT + 3000, listener);

  assert.deepEqual(scene.sent, ['PUT /progress']);
});

test('Storyteller formats, identifiers and odd places are read sensibly', async () => {
  const books = [
    { ...book(0.2), uuid: 'audio-only', ebook: null, readaloud: null, audiobook: { duration: 36000 } },
    { ...book(0.2), uuid: 'readaloud', ebook: null, readaloud: { status: 'ALIGNED' }, audiobook: { duration: 36000 } },
    {
      ...book(0.2),
      uuid: 'ids',
      identifiers: [
        { type: 'isbn-13', value: '9780141439471' },
        { type: 'ISBN-13', value: '9780141439471' },
        { type: 'asin', value: 'B00TEST000' },
        { type: 'doi', value: '10.1000/xyz' },
      ],
    },
    { ...book(1.4), uuid: 'over' },
    { ...book(-0.2), uuid: 'under' },
    { ...book(0.2), uuid: 'untitled', title: '  ' },
  ];
  const source = new StorytellerSource({ kind: 'storyteller', url: URL_HOME, token: 't', refreshToken: null }, async () => answer(200, books));
  const places = Object.fromEntries((await source.progressSince(0)).map((progress) => [progress.bookId, [progress.fraction, progress.finished]]));

  assert.deepEqual(await source.book('audio-only').then((found) => [found?.format, found?.durationSeconds]), ['audiobook', 36000]);
  assert.deepEqual(await source.book('readaloud').then((found) => [found?.format, found?.durationSeconds]), ['epub', null]);
  assert.equal((await source.book('ids'))?.identifiers, 'isbn:9780141439471\nasin:B00TEST000');
  assert.deepEqual(places.over, [1, true]);
  assert.deepEqual(places.under, [0, false]);
  assert.equal(await source.book('untitled'), null);
  assert.equal(await source.book('gone'), null);
});

test('a Storyteller that cannot be reached is an error, never an empty library', async () => {
  const source = new StorytellerSource({ kind: 'storyteller', url: URL_HOME, token: 't', refreshToken: null }, async () => {
    throw new TypeError('fetch failed');
  });

  await assert.rejects(source.progressSince(0), UnreachableError);
  assert.equal(await source.cover('anything'), null);
});
