import { MS_PER_SECOND } from '../constants.js';
import type { SourceAccess } from '../state.js';

const SOCKET_PATH = '/socket.io/?EIO=4&transport=websocket';
const OPEN_PACKET = '0';
const PING_PACKET = '2';
const PONG_PACKET = '3';
const CONNECT_PACKET = '40';
const EVENT_PACKET = '42';
const FIRST_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 120;
const CHANGE_EVENTS: readonly string[] = ['user_item_progress_updated', 'user_updated', 'user_stream_closed'];

export class AudiobookshelfLive {
  private socket: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retrySeconds = FIRST_RETRY_SECONDS;
  private stopped = true;

  constructor(
    private readonly access: SourceAccess,
    private readonly onChange: () => void,
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    let socket: WebSocket;

    try {
      socket = new WebSocket(`${this.access.url.replace(/^http/i, 'ws')}${SOCKET_PATH}`);
    } catch {
      this.retryLater();

      return;
    }

    this.socket = socket;
    socket.addEventListener('message', (event) => this.receive(socket, String(event.data)));
    socket.addEventListener('close', () => this.retryLater());
    socket.addEventListener('error', () => socket.close());
  }

  private receive(socket: WebSocket, packet: string): void {
    if (packet.startsWith(EVENT_PACKET)) {
      this.retrySeconds = FIRST_RETRY_SECONDS;

      if (CHANGE_EVENTS.includes(eventName(packet.slice(EVENT_PACKET.length)))) {
        this.onChange();
      }

      return;
    }

    if (packet.startsWith(CONNECT_PACKET)) {
      socket.send(`${EVENT_PACKET}${JSON.stringify(['auth', this.access.token])}`);

      return;
    }

    if (packet.startsWith(OPEN_PACKET)) {
      socket.send(CONNECT_PACKET);

      return;
    }

    if (packet === PING_PACKET) {
      socket.send(PONG_PACKET);
    }
  }

  private retryLater(): void {
    this.socket = null;

    if (this.stopped || this.retryTimer !== null) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retrySeconds * MS_PER_SECOND);
    this.retrySeconds = Math.min(MAX_RETRY_SECONDS, this.retrySeconds * 2);
  }
}

function eventName(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown;

    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : '';
  } catch {
    return '';
  }
}
