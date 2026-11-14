import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, duration, renderPage, type ListenerView, type PageModel } from '../src/page.js';

const NOW = Date.parse('2026-11-14T12:00:00');
const MINUTE = 60_000;

function model(listeners: readonly ListenerView[], extra: Partial<PageModel> = {}): PageModel {
  return { now: NOW, foundServers: [], update: null, formProblem: null, waitingBooksLink: 'https://seekquel.test/waiting', listeners, ...extra };
}

function listener(extra: Partial<ListenerView>): ListenerView {
  return {
    id: '0b9c1a52-6f0e-4c3e-9a55-3f6d6a1f2c11',
    name: 'jo',
    sourceName: 'Audiobookshelf',
    address: 'http://abs.test',
    state: 'connected',
    pairing: null,
    lastSyncAt: NOW - 2 * MINUTE,
    problem: null,
    books: [],
    ...extra,
  };
}

test('times read the way a person says them', () => {
  assert.equal(ago(NOW, NOW - 10_000), 'just now');
  assert.equal(ago(NOW, NOW - MINUTE), 'a minute ago');
  assert.equal(ago(NOW, NOW - 12 * MINUTE), '12 minutes ago');
  assert.equal(ago(NOW, NOW - 3 * 60 * MINUTE), '3 hours ago');
  assert.equal(duration(40), '1 min');
  assert.equal(duration(75 * 60), '1 h 15 min');
});

test('a found server is not shown as an address to type', () => {
  const page = renderPage(model([], { foundServers: [{ name: 'Audiobookshelf', url: 'http://host.docker.internal:13378' }] }));

  assert.match(page, /Found your Audiobookshelf/);
  assert.match(page, /<input type="hidden" name="address" value="http:\/\/host.docker.internal:13378">/);
  assert.match(page, /<details><summary>Use a different address<\/summary>/);
});

test('two servers found on the machine are offered as a choice', () => {
  const page = renderPage(
    model([], {
      foundServers: [
        { name: 'Audiobookshelf', url: 'http://audiobookshelf' },
        { name: 'Storyteller', url: 'http://storyteller:8001' },
      ],
    }),
  );

  assert.match(page, /<legend>Which server\?<\/legend>/);
  assert.match(page, /value="http:\/\/audiobookshelf" checked>Audiobookshelf/);
  assert.match(page, /value="http:\/\/storyteller:8001">Storyteller/);
});

test('the approve step offers a button, a code to scan and the typed code', () => {
  const page = renderPage(
    model([listener({ state: 'pairing', pairing: { userCode: 'ABCD-EFGH', link: 'https://seekquel.test/pair?code=ABCDEFGH' } })]),
  );

  assert.match(page, /href="https:\/\/seekquel.test\/pair\?code=ABCDEFGH"/);
  assert.match(page, /<svg class="qr"/);
  assert.match(page, /ABCD-EFGH/);
  assert.match(page, /http-equiv="refresh" content="5"/);
});

test('a connected listener sees each book, and a waiting book links to where it is chosen', () => {
  const page = renderPage(
    model([
      listener({
        books: [
          { document: 'abs:1', title: 'Placed & <Fine>', authors: 'A. Writer', hasCover: true, secondsToday: 1500, percent: 42, finished: false, waiting: false, lastSentAt: NOW - MINUTE },
          { document: 'abs:2', title: 'Unplaced', authors: null, hasCover: false, secondsToday: 60, percent: 3, finished: false, waiting: true, lastSentAt: null },
        ],
      }),
    ]),
  );

  assert.match(page, /Checked 2 minutes ago/);
  assert.match(page, /Placed &amp; &lt;Fine&gt;/);
  assert.match(page, /42% through · 25 min today · sent a minute ago/);
  assert.match(page, /href="https:\/\/seekquel.test\/waiting"/);
  assert.match(page, /Add another account/);
});

test('a problem is said in plain words and the page stops reloading while a form is open', () => {
  const page = renderPage(model([listener({ state: 'signed-out', problem: 'Your server signed this account out. Sign in again below.' })]));

  assert.match(page, /role="alert">Your server signed this account out/);
  assert.doesNotMatch(page, /http-equiv="refresh"/);
});

test('a newer version is announced at the top with the command that updates it', () => {
  const page = renderPage(model([listener({})], { update: '0.2.0' }));

  assert.match(page, /Version 0\.2\.0 is available/);
  assert.match(page, /install\.sh \| sh/);
  assert.match(page, /install\.ps1 \| iex/);
  assert.doesNotMatch(renderPage(model([listener({})])), /is available/);
});
