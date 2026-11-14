import type { Config } from '../config.js';
import type { Fetch } from '../http.js';
import type { SourceAccess } from '../state.js';

export type SourceFormat = 'audiobook' | 'epub';

export interface SourceBook {
  readonly id: string;
  readonly title: string;
  readonly authors: string | null;
  readonly format: SourceFormat;
  readonly identifiers: string | null;
  readonly durationSeconds: number | null;
  readonly hasCover: boolean;
}

export interface SourceProgress {
  readonly bookId: string;
  readonly fraction: number;
  readonly positionSeconds: number | null;
  readonly finished: boolean;
  readonly updatedAt: number;
}

export interface SourceSitting {
  readonly bookId: string;
  readonly sittingId: string;
  readonly date: string;
  readonly seconds: number;
  readonly updatedAt: number;
}

export interface SourceImage {
  readonly type: string;
  readonly bytes: Buffer;
}

export interface Source {
  readonly key: string;
  readonly name: string;
  progressSince(since: number): Promise<readonly SourceProgress[]>;
  sittingsSince(since: number): Promise<readonly SourceSitting[]>;
  book(id: string): Promise<SourceBook | null>;
  cover(id: string): Promise<SourceImage | null>;
}

export type ServerKind = 'audiobookshelf' | 'storyteller';

export class SourceSignedOutError extends Error {}

export class SignInRefusedError extends Error {}

export interface SignedIn {
  readonly access: SourceAccess;
  readonly name: string | null;
}

export interface LiveFeed {
  start(): void;
  stop(): void;
}

export interface SourceDeps {
  readonly config: Config;
  readonly fetcher: Fetch;
  readonly remember: (access: SourceAccess) => Promise<void>;
}

export interface ServerType {
  readonly kind: ServerKind;
  readonly name: string;
  readonly usualAddresses: readonly string[];
  detect(fetcher: Fetch, url: string): Promise<boolean>;
  signIn(fetcher: Fetch, url: string, username: string, password: string): Promise<SignedIn>;
  source(access: SourceAccess, deps: SourceDeps): Source;
  live(access: SourceAccess, onChange: () => void): LiveFeed | null;
}
