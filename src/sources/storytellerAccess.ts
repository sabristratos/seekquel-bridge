import { asString, field, HttpError, requestJson, UnreachableError, type Fetch } from '../http.js';
import { SignInRefusedError, type SignedIn } from './types.js';

const SERVICE = 'Storyteller';
const HEALTHY = 'healthy';
const GREETING = 'World';
const HTTP_UNAUTHORIZED = 401;
const PROBE_TIMEOUT_MS = 3000;

export const STORYTELLER_ADDRESSES: readonly string[] = [
  'http://storyteller:8001',
  'http://storyteller',
  'http://host.docker.internal:8001',
  'http://localhost:8001',
];

export async function isStoryteller(fetcher: Fetch, url: string): Promise<boolean> {
  try {
    const [health, greeting] = await Promise.all([
      requestJson(fetcher, { service: SERVICE, method: 'GET', url: `${url}/api/health`, timeoutMs: PROBE_TIMEOUT_MS }),
      requestJson(fetcher, { service: SERVICE, method: 'GET', url: `${url}/api`, timeoutMs: PROBE_TIMEOUT_MS }),
    ]);

    return asString(field(health, 'status')) === HEALTHY && asString(field(greeting, 'Hello')) === GREETING;
  } catch (error) {
    if (error instanceof HttpError || error instanceof UnreachableError) {
      return false;
    }

    throw error;
  }
}

export async function signInToStoryteller(fetcher: Fetch, url: string, username: string, password: string): Promise<SignedIn> {
  let answer: unknown;

  try {
    answer = await requestJson(fetcher, {
      service: SERVICE,
      method: 'POST',
      url: `${url}/api/v2/token`,
      form: { usernameOrEmail: username, password },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === HTTP_UNAUTHORIZED) {
      throw new SignInRefusedError('Storyteller did not accept that username and password.');
    }

    throw error;
  }

  const token = asString(field(answer, 'access_token'));

  if (token === null) {
    throw new SignInRefusedError('Storyteller signed in but gave no token this version understands.');
  }

  return { access: { kind: 'storyteller', url, token, refreshToken: null }, name: (await accountName(fetcher, url, token)) ?? username };
}

async function accountName(fetcher: Fetch, url: string, token: string): Promise<string | null> {
  try {
    const user = await requestJson(fetcher, { service: SERVICE, method: 'GET', url: `${url}/api/v2/user`, token });

    return asString(field(user, 'username'));
  } catch (error) {
    if (error instanceof HttpError || error instanceof UnreachableError) {
      return null;
    }

    throw error;
  }
}
