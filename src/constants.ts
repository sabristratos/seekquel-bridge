export const APP_NAME = 'Seekquel Bridge';
export const APP_VERSION = '0.1.2';
export const DEVICE_IDENTIFIER = 'seekquel-bridge';
export const READING_CLIENT = 'seekquel-bridge';

export const DEFAULT_SEEKQUEL_API_URL = 'https://api.seekquel.app/reading';
export const DEFAULT_SEEKQUEL_APP_URL = 'https://seekquel.app';
export const PAIRING_LINK_PATH = '/settings/integrations/seekquel-bridge';
export const WAITING_BOOKS_PATH = '/settings/integrations/koreader/books';
export const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/sabristratos/seekquel-bridge/main';
export const TICK_SECONDS = 2;
export const NUDGE_DELAY_SECONDS = 5;
export const MIN_SECONDS_BETWEEN_NUDGED_SYNCS = 20;
export const MAX_FORM_BYTES = 4096;
export const DEFAULT_DATA_DIR = '/data';
export const DEFAULT_STATUS_PORT = 4410;
export const DEFAULT_POLL_SECONDS = 300;
export const MIN_POLL_SECONDS = 60;

export const STATE_FILE_NAME = 'state.json';
export const STATE_VERSION = 2;

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_BACKOFF_SECONDS = 3600;
export const PAIRING_SLOW_DOWN_SECONDS = 5;

export const SECONDS_PER_DAY = 86_400;
export const MS_PER_SECOND = 1000;
export const MS_PER_DAY = SECONDS_PER_DAY * MS_PER_SECOND;

export const DAYS_KEPT = 14;
export const MAX_DOCUMENT_LENGTH = 64;
export const MAX_TEXT_LENGTH = 500;
export const MAX_ERRORS_KEPT = 20;

export const MIN_FRACTION_DELTA = 0.0001;
export const READING_AFTER_SECONDS = 180;
export const READING_AFTER_FRACTION = 0.01;
