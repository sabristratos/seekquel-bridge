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
