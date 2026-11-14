import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { StateStore } from '../src/state.js';

test('a state file from the first version becomes one listener and keeps its connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-'));

  await writeFile(
    join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      source: { url: 'http://abs.test', token: 't', refreshToken: 'r' },
      deviceKey: 'key',
      pairedAt: 5,
      cursors: { abs: { progress: 9, sittings: 9 } },
      books: { 'abs:1': { book: null, placed: true, lastFraction: 0.5, finishedSent: false, finishPending: false, days: {}, dirtyDays: [] } },
    }),
  );

  const state = await new StateStore(dir).load();

  assert.equal(state.listeners.length, 1);
  assert.equal(state.listeners[0]?.deviceKey, 'key');
  assert.equal(state.listeners[0]?.cursors.abs?.progress, 9);
  assert.equal(state.listeners[0]?.books['abs:1']?.lastSentAt, null);
});

test('a state file from 0.1.0 or 0.1.1 loads as Audiobookshelf, keeps its connection and gains the new fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-'));

  await writeFile(
    join(dir, 'state.json'),
    JSON.stringify({
      version: 2,
      listeners: [
        {
          id: 'l1',
          name: 'tester',
          source: { url: 'http://abs.test', token: 't', refreshToken: 'r' },
          signedOut: false,
          deviceKey: 'key',
          pairedAt: 5,
          cursors: { abs: { progress: 9, sittings: 9 } },
          books: { 'abs:1': { book: null, placed: true, lastFraction: 0.5, lastSentAt: 7, finishedSent: true, finishPending: false, days: {}, dirtyDays: [] } },
        },
      ],
    }),
  );

  const listener = (await new StateStore(dir).load()).listeners[0];
  const book = listener?.books['abs:1'];

  assert.equal(listener?.source.kind, 'audiobookshelf');
  assert.equal(listener?.deviceKey, 'key');
  assert.equal(book?.finishedSent, true);
  assert.equal(book?.readingSent, false);
  assert.equal(book?.awaitingReader, false);
  assert.equal(book?.startFraction, null);
  assert.deepEqual(book?.listenedSinceFinish, {});
});
