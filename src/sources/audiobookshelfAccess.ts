import { asString, field, HttpError, requestJson, UnreachableError, type Fetch } from '../http.js';
import type { SourceAccess } from '../state.js';

const SERVICE = 'Audiobookshelf';
const APP_ID = 'audiobookshelf';
const HTTP_UNAUTHORIZED = 401;
const PROBE_TIMEOUT_MS = 3000;
const RETURN_TOKENS_HEADER = { 'x-return-tokens': 'true' };

export const USUAL_ADDRESSES: readonly string[] = [
  'http://audiobookshelf',
  'http://audiobookshelf:80',
  'http://audiobookshelf:13378',
  'http://host.docker.internal:13378',
  'http://localhost:13378',
];

export class SignInRefusedError extends Error {}

export async function isAudiobookshelf(fetcher: Fetch, url: string): Promise<boolean> {
  try {
    const status = await requestJson(fetcher, {
      service: SERVICE,
      method: 'GET',
      url: `${url}/status`,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    return asString(field(status, 'app')) === APP_ID;
  } catch (error) {
    if (error instanceof HttpError || error instanceof UnreachableError) {
      return false;
    }

    throw error;
  }
}

export async function findServer(fetcher: Fetch, addresses: readonly string[]): Promise<string | null> {
  const answers = await Promise.all(addresses.map((address) => isAudiobookshelf(fetcher, address)));
  const found = answers.indexOf(true);

  return found === -1 ? null : (addresses[found] ?? null);
}

export interface SignedIn {
  readonly access: SourceAccess;
  readonly name: string | null;
}

export async function signIn(fetcher: Fetch, url: string, username: string, password: string): Promise<SignedIn> {
  let answer: unknown;

  try {
    answer = await requestJson(fetcher, {
      service: SERVICE,
      method: 'POST',
      url: `${url}/login`,
      headers: RETURN_TOKENS_HEADER,
      body: { username, password },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === HTTP_UNAUTHORIZED) {
      throw new SignInRefusedError('Audiobookshelf did not accept that username and password.');
    }

    throw error;
  }

  const access = accessFrom(url, answer);

  if (access === null) {
    throw new SignInRefusedError('Audiobookshelf signed in but gave no token this version understands.');
  }

  return { access, name: asString(field(field(answer, 'user'), 'username')) ?? username };
}

export async function renew(fetcher: Fetch, access: SourceAccess): Promise<SourceAccess | null> {
  if (access.refreshToken === null) {
    return null;
  }

  try {
    const answer = await requestJson(fetcher, {
      service: SERVICE,
      method: 'POST',
      url: `${access.url}/auth/refresh`,
      headers: { 'x-refresh-token': access.refreshToken },
    });

    return accessFrom(access.url, answer);
  } catch (error) {
    if (error instanceof HttpError) {
      return null;
    }

    throw error;
  }
}

function accessFrom(url: string, answer: unknown): SourceAccess | null {
  const user = field(answer, 'user');
  const token = asString(field(user, 'accessToken')) ?? asString(field(user, 'token'));

  return token === null ? null : { url, token, refreshToken: asString(field(user, 'refreshToken')) };
}
