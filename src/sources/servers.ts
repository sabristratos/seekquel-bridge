import type { Fetch } from '../http.js';
import { AudiobookshelfSource } from './audiobookshelf.js';
import { isAudiobookshelf, signIn as signInToAudiobookshelf, USUAL_ADDRESSES as AUDIOBOOKSHELF_ADDRESSES } from './audiobookshelfAccess.js';
import { AudiobookshelfLive } from './audiobookshelfLive.js';
import { StorytellerSource } from './storyteller.js';
import { isStoryteller, signInToStoryteller, STORYTELLER_ADDRESSES } from './storytellerAccess.js';
import type { ServerKind, ServerType } from './types.js';

export interface FoundServer {
  readonly type: ServerType;
  readonly url: string;
}

const audiobookshelf: ServerType = {
  kind: 'audiobookshelf',
  name: 'Audiobookshelf',
  usualAddresses: AUDIOBOOKSHELF_ADDRESSES,
  detect: isAudiobookshelf,
  signIn: signInToAudiobookshelf,
  source: (access, deps) => new AudiobookshelfSource(access, deps.config.audiobookshelf.libraries, deps.fetcher, deps.remember),
  live: (access, onChange) => new AudiobookshelfLive(access, onChange),
};

const storyteller: ServerType = {
  kind: 'storyteller',
  name: 'Storyteller',
  usualAddresses: STORYTELLER_ADDRESSES,
  detect: isStoryteller,
  signIn: signInToStoryteller,
  source: (access, deps) => new StorytellerSource(access, deps.fetcher),
  live: () => null,
};

export const SERVER_TYPES: readonly ServerType[] = [audiobookshelf, storyteller];

export function serverType(kind: ServerKind): ServerType {
  return SERVER_TYPES.find((type) => type.kind === kind) ?? audiobookshelf;
}

export async function detectServer(fetcher: Fetch, url: string): Promise<ServerType | null> {
  for (const type of SERVER_TYPES) {
    if (await type.detect(fetcher, url)) {
      return type;
    }
  }

  return null;
}

export async function findServers(fetcher: Fetch): Promise<FoundServer[]> {
  const found = await Promise.all(
    SERVER_TYPES.map(async (type) => {
      const answers = await Promise.all(type.usualAddresses.map((address) => type.detect(fetcher, address)));
      const at = answers.indexOf(true);

      return at === -1 ? null : { type, url: type.usualAddresses[at] ?? '' };
    }),
  );

  return found.filter((server): server is FoundServer => server !== null && server.url !== '');
}
