import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { MAX_FORM_BYTES } from './constants.js';
import { renderPage, type PageModel } from './page.js';
import type { SourceImage } from './sources/types.js';

const HTTP_OK = 200;
const HTTP_SEE_OTHER = 303;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const FONT_CACHE = 'public, max-age=31536000, immutable';
const COVER_CACHE = 'private, max-age=3600';
const NO_CACHE = 'no-store';
const ASSETS: Readonly<Record<string, string>> = {
  '/assets/young-serif.woff2': 'young-serif.woff2',
  '/assets/literata.woff2': 'literata.woff2',
};
const LISTENER_ROUTE = /^\/listeners\/([0-9a-f-]{36})\/(check|disconnect)$/;
const COVER_ROUTE = /^\/listeners\/([0-9a-f-]{36})\/covers\/([^/]+)$/;

export interface SignInAnswer {
  readonly address: string;
  readonly username: string;
  readonly password: string;
}

export interface BridgeActions {
  page(): PageModel;
  health(): Record<string, unknown>;
  signIn(answer: SignInAnswer): Promise<void>;
  checkNow(listenerId: string): void;
  disconnect(listenerId: string): Promise<void>;
  cover(listenerId: string, document: string): Promise<SourceImage | null>;
}

export function startServer(actions: BridgeActions, port: number): Server {
  const server = createServer((request, response) => {
    route(actions, request, response).catch(() => {
      if (!response.headersSent) {
        send(response, HTTP_NOT_FOUND, 'text/plain', 'Not found', NO_CACHE);
      }
    });
  });

  server.listen(port);

  return server;
}

async function route(actions: BridgeActions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://bridge').pathname;

  if (request.method === 'POST') {
    await post(actions, path, request, response);

    return;
  }

  if (path === '/') {
    send(response, HTTP_OK, 'text/html; charset=utf-8', renderPage(actions.page()), NO_CACHE);

    return;
  }

  if (path === '/health') {
    send(response, HTTP_OK, 'application/json', JSON.stringify(actions.health()), NO_CACHE);

    return;
  }

  const asset = ASSETS[path];

  if (asset !== undefined) {
    const bytes = await readFile(fileURLToPath(new URL(`../../assets/${asset}`, import.meta.url)));

    send(response, HTTP_OK, 'font/woff2', bytes, FONT_CACHE);

    return;
  }

  const cover = COVER_ROUTE.exec(path);
  const image = cover === null ? null : await actions.cover(cover[1] ?? '', decodeURIComponent(cover[2] ?? ''));

  if (image === null) {
    send(response, HTTP_NOT_FOUND, 'text/plain', 'Not found', NO_CACHE);

    return;
  }

  send(response, HTTP_OK, image.type, image.bytes, COVER_CACHE);
}

async function post(actions: BridgeActions, path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!sameOrigin(request)) {
    send(response, HTTP_FORBIDDEN, 'text/plain', 'Forbidden', NO_CACHE);

    return;
  }

  const form = await readForm(request);

  if (form === null) {
    send(response, HTTP_TOO_LARGE, 'text/plain', 'Too large', NO_CACHE);

    return;
  }

  const listener = LISTENER_ROUTE.exec(path);

  if (path === '/listeners') {
    await actions.signIn({
      address: (form.get('customAddress')?.trim() || form.get('address')?.trim()) ?? '',
      username: form.get('username')?.trim() ?? '',
      password: form.get('password') ?? '',
    });
  } else if (listener?.[2] === 'check') {
    actions.checkNow(listener[1] ?? '');
  } else if (listener?.[2] === 'disconnect') {
    await actions.disconnect(listener[1] ?? '');
  } else {
    send(response, HTTP_NOT_FOUND, 'text/plain', 'Not found', NO_CACHE);

    return;
  }

  response.writeHead(HTTP_SEE_OTHER, { Location: '/' });
  response.end();
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;

  if (origin === undefined) {
    return true;
  }

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const piece = chunk as Buffer;

    size += piece.length;

    if (size > MAX_FORM_BYTES) {
      return null;
    }

    chunks.push(piece);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, code: number, type: string, body: string | Buffer, cache: string): void {
  response.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache });
  response.end(body);
}
