import {
  APP_NAME,
  DEFAULT_DATA_DIR,
  DEFAULT_POLL_SECONDS,
  DEFAULT_SEEKQUEL_API_URL,
  DEFAULT_SEEKQUEL_APP_URL,
  DEFAULT_STATUS_PORT,
  MIN_POLL_SECONDS,
} from './constants.js';

export interface AudiobookshelfConfig {
  readonly url: string | null;
  readonly token: string | null;
  readonly libraries: readonly string[];
}

export interface Config {
  readonly seekquelApiUrl: string;
  readonly seekquelAppUrl: string;
  readonly dataDir: string;
  readonly statusPort: number;
  readonly pollSeconds: number;
  readonly deviceName: string;
  readonly audiobookshelf: AudiobookshelfConfig;
}

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env): Config {
  return {
    seekquelApiUrl: readUrl(env, 'SEEKQUEL_API_URL') ?? DEFAULT_SEEKQUEL_API_URL,
    seekquelAppUrl: readUrl(env, 'SEEKQUEL_APP_URL') ?? DEFAULT_SEEKQUEL_APP_URL,
    dataDir: text(env.DATA_DIR) ?? DEFAULT_DATA_DIR,
    statusPort: readInteger(env, 'STATUS_PORT', DEFAULT_STATUS_PORT, 1),
    pollSeconds: readInteger(env, 'POLL_SECONDS', DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS),
    deviceName: text(env.DEVICE_NAME) ?? APP_NAME,
    audiobookshelf: readAudiobookshelf(env),
  };
}

function readAudiobookshelf(env: Env): AudiobookshelfConfig {
  return { url: readUrl(env, 'ABS_URL'), token: text(env.ABS_TOKEN), libraries: list(env.ABS_LIBRARIES) };
}

function readUrl(env: Env, name: string): string | null {
  const value = text(env[name]);

  if (value === null) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid address: ${value}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${name} must start with http:// or https://`);
  }

  return value.replace(/\/+$/, '');
}

function readInteger(env: Env, name: string, fallback: number, minimum: number): number {
  const value = text(env[name]);

  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`${name} must be a whole number.`);
  }

  return Math.max(minimum, parsed);
}

function list(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}
