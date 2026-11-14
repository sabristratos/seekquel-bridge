import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudiobookshelfSource, SourceSignedOutError } from '../src/sources/audiobookshelf.js';
import { findServer, signIn, SignInRefusedError } from '../src/sources/audiobookshelfAccess.js';
import type { SourceAccess } from '../src/state.js';

const URL_HOME = 'http://abs.test';

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

test('the server is found among the usual addresses', async () => {
  const fetcher: typeof fetch = async (input) =>
    String(input) === `${URL_HOME}/status` ? answer(200, { app: 'audiobookshelf' }) : answer(200, { app: 'something-else' });

  assert.equal(await findServer(fetcher, ['http://other.test', URL_HOME]), URL_HOME);
  assert.equal(await findServer(fetcher, ['http://other.test']), null);
});

test('signing in keeps the tokens and never the password', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('x-return-tokens'), 'true');

    return answer(200, { user: { accessToken: 'access-1', refreshToken: 'refresh-1', token: 'legacy' } });
  };

  assert.deepEqual(await signIn(fetcher, URL_HOME, 'jo', 'secret'), {
    access: { kind: 'audiobookshelf', url: URL_HOME, token: 'access-1', refreshToken: 'refresh-1' },
    name: 'jo',
  });
});

test('a wrong password is said plainly', async () => {
  const fetcher: typeof fetch = async () => answer(401, {});

  await assert.rejects(signIn(fetcher, URL_HOME, 'jo', 'wrong'), SignInRefusedError);
});

test('an expired sign-in is renewed once and remembered', async () => {
  const remembered: SourceAccess[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;

    if (path === '/auth/refresh') {
      return answer(200, { user: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
    }

    return new Headers(init?.headers).get('Authorization') === 'Bearer access-2'
      ? answer(200, { mediaProgress: [] })
      : answer(401, {});
  };
  const source = new AudiobookshelfSource(
    { kind: 'audiobookshelf', url: URL_HOME, token: 'access-1', refreshToken: 'refresh-1' },
    [],
    fetcher,
    async (access) => void remembered.push(access),
  );

  assert.deepEqual(await source.progressSince(0), []);
  assert.deepEqual(remembered, [{ kind: 'audiobookshelf', url: URL_HOME, token: 'access-2', refreshToken: 'refresh-2' }]);
});

test('a sign-in that cannot be renewed asks the reader to sign in again', async () => {
  const fetcher: typeof fetch = async () => answer(401, {});
  const source = new AudiobookshelfSource({ kind: 'audiobookshelf', url: URL_HOME, token: 'old', refreshToken: null }, [], fetcher, async () => undefined);

  await assert.rejects(source.progressSince(0), SourceSignedOutError);
});
