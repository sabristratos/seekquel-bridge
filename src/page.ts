import qrcode from 'qrcode-generator';
import { APP_NAME, APP_VERSION, MS_PER_SECOND } from './constants.js';

const PAIRING_REFRESH_SECONDS = 5;
const CONNECTED_REFRESH_SECONDS = 30;
const QR_QUIET_MODULES = 4;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const JUST_NOW_SECONDS = 45;

export interface BookView {
  readonly document: string;
  readonly title: string;
  readonly authors: string | null;
  readonly hasCover: boolean;
  readonly secondsToday: number;
  readonly percent: number | null;
  readonly finished: boolean;
  readonly waiting: boolean;
  readonly lastSentAt: number | null;
}

export interface ListenerView {
  readonly id: string;
  readonly name: string | null;
  readonly sourceName: string;
  readonly address: string;
  readonly state: 'signed-out' | 'pairing' | 'connected';
  readonly pairing: { readonly userCode: string; readonly link: string } | null;
  readonly lastSyncAt: number | null;
  readonly problem: string | null;
  readonly books: readonly BookView[];
}

export interface PageModel {
  readonly now: number;
  readonly foundAddress: string | null;
  readonly formProblem: { readonly address: string; readonly message: string } | null;
  readonly waitingBooksLink: string;
  readonly listeners: readonly ListenerView[];
}

const LOGO = `<svg class="mark" viewBox="-232 0 1784 1784" aria-hidden="true"><path class="mark-ribbon" d="M390.54,1783.527l0,-484.414c0,-92.897 67.571,-168.204 150.923,-168.204c0,0 121.543,-0 196.909,-0c-101.729,0 -91.554,190.379 -91.554,286.602c0,130.361 -0,366.016 -0,366.016l-128.139,-116.15l-128.139,116.15Z"/><path class="mark-shadow" d="M390.54,1507.108l-0,-193.698c0,-100.793 67.571,-182.502 150.923,-182.502l196.909,-0c-101.729,0 -91.554,206.562 -91.554,310.964l0,121.718c-107.852,-6.882 -189.261,-26.178 -256.279,-56.482Z"/><path class="mark-body" fill-rule="nonzero" d="M0,728.999c0,0 0,-1.255 0.001,-1.724c0.173,-119.389 18.328,-224.253 54.464,-314.595c36.31,-90.776 85.888,-166.539 148.733,-227.289c62.845,-60.75 133.72,-106.836 212.625,-138.258c78.905,-31.422 160.254,-47.134 244.047,-47.134c85.19,0 167.237,15.013 246.142,45.039c78.905,30.026 149.431,75.414 211.577,136.164c62.146,60.75 111.375,136.862 147.685,228.336c36.148,91.066 54.303,197.011 54.464,317.836c0.001,0.436 0.001,1.625 0.001,1.625c0,118.707 -18.155,223.797 -54.465,315.271c-36.31,91.474 -85.539,167.586 -147.685,228.336c-62.146,60.75 -132.672,106.836 -211.577,138.258c-78.905,31.422 -160.952,47.134 -246.142,47.134c-85.19,0 -214.518,-21.839 -305.845,-73.317c-93.22,-52.545 -186.438,-132.325 -253.473,-241.954c-67.034,-109.629 -100.552,-247.539 -100.552,-413.728Zm659.87,685.008c76.81,0 138.957,-20.599 186.439,-61.797c47.483,-41.198 82.047,-111.724 103.694,-211.577c21.647,-99.853 32.47,-237.064 32.47,-411.633c0,-175.965 -10.823,-313.875 -32.47,-413.728c-21.647,-99.853 -56.211,-170.379 -103.694,-211.577c-47.483,-41.198 -109.629,-61.797 -186.439,-61.797c-75.414,0 -136.862,20.599 -184.345,61.797c-47.483,41.198 -82.047,111.724 -103.694,211.577c-21.647,99.853 -32.47,237.763 -32.47,413.728c0,174.569 10.823,311.78 32.47,411.633c21.647,99.853 56.211,170.379 103.694,211.577c47.483,41.198 108.931,61.797 184.345,61.797Z"/><path class="mark-ribbon" d="M806.214,1130.908c41.397,0 78.068,26.704 90.775,66.104c51.39,157.275 189.242,539.262 309.864,520.604c-35.174,31.263 -83.49,48.269 -131.713,57.132c-104.001,19.325 -208.144,-32.984 -254.737,-127.952c-20.39,-41.648 -44.539,-93.978 -71.736,-158.122c-74.828,-176.483 -87.487,-357.765 -216.751,-357.765c121.994,0 215.673,0 274.297,0Z"/></svg>`;

const STYLES = `
@font-face { font-family: 'Young Serif'; src: url('/assets/young-serif.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'Literata'; src: url('/assets/literata.woff2') format('woff2'); font-weight: 200 900; font-display: swap; }
:root {
  --page: #F5F5F4; --card: #FFFFFF; --sunken: #E8E7E3; --ink: #1E1C15; --ink-soft: #5A594B; --line: #E8E7E3;
  --action: #B04E2F; --action-hover: #9E4530; --on-action: #FAFAF9; --problem-ink: #B91C1C; --problem-wash: #FBEDEA;
  --ribbon: #C65D3B; --ribbon-shadow: #9E4530;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #0D0C08; --card: #1E1C15; --sunken: #24211D; --ink: #FAFAF9; --ink-soft: #ABA79B; --line: #24211D;
    --action: #CD6D42; --action-hover: #B04E2F; --on-action: #1E1C15; --problem-ink: #F0958F; --problem-wash: #2B1614;
    --ribbon: #D87355;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1rem 4rem; font-family: 'Literata', Georgia, serif; font-size: 1rem; line-height: 1.5; color: var(--ink); background: var(--page); }
main { max-width: 34rem; margin: 0 auto; }
header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; }
.mark { width: 2.25rem; height: 2.25rem; flex: none; }
.mark-body { fill: var(--ink); } .mark-ribbon { fill: var(--ribbon); } .mark-shadow { fill: var(--ribbon-shadow); }
h1, h2, h3 { font-family: 'Young Serif', Georgia, serif; font-weight: 400; margin: 0; }
h1 { font-size: 1.375rem; }
h2 { font-size: 1.5rem; line-height: 1.25; margin-bottom: 0.5rem; }
h3 { font-size: 1.125rem; }
p { margin: 0 0 0.75rem; }
a { color: var(--action); }
.soft { color: var(--ink-soft); }
.small { font-size: 0.875rem; }
.card { background: var(--card); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
.listener + .listener { margin-top: 2.5rem; }
.listener-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
label { display: block; margin-top: 1rem; font-weight: 600; font-size: 0.9375rem; }
input { display: block; width: 100%; margin-top: 0.375rem; padding: 0.75rem 0.875rem; font: inherit; color: inherit; background: var(--page); border: 1px solid var(--line); border-radius: 8px; }
input:focus-visible, button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--action); outline-offset: 2px; }
.button { display: inline-block; white-space: nowrap; padding: 0.75rem 1.5rem; font: inherit; font-weight: 600; color: var(--on-action); background: var(--action); border: 0; border-radius: 9999px; text-decoration: none; cursor: pointer; }
.button:hover { background: var(--action-hover); }
.button.quiet { color: var(--action); background: var(--sunken); }
.button.plain { padding: 0.5rem 1rem; font-size: 0.9375rem; }
form.inline { display: inline; }
.actions { margin-top: 1.25rem; }
.found { display: flex; align-items: baseline; gap: 0.5rem; }
details { margin-top: 1rem; }
summary { cursor: pointer; color: var(--action); font-size: 0.9375rem; }
.approve { display: grid; grid-template-columns: 1fr auto; gap: 1.5rem; align-items: center; }
.qr { width: 8.5rem; height: 8.5rem; padding: 0.5rem; background: #FFFFFF; border-radius: 8px; }
.qr path { fill: #1E1C15; }
.qr-note { max-width: 8.5rem; margin: 0.5rem 0 0; text-align: center; }
.code { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 1.375rem; letter-spacing: 0.12em; user-select: all; }
.problem { padding: 0.875rem 1rem; margin-bottom: 1rem; color: var(--problem-ink); background: var(--problem-wash); border-radius: 8px; }
.books { list-style: none; margin: 0; padding: 0; }
.book { display: grid; grid-template-columns: 3rem 1fr; gap: 0.875rem; align-items: center; padding: 0.75rem 0; }
.book + .book { border-top: 1px solid var(--line); }
.cover { width: 3rem; height: 4.5rem; object-fit: cover; border-radius: 4px; background: var(--sunken); display: grid; place-items: center; }
.cover .mark { width: 1.25rem; height: 1.25rem; opacity: 0.35; }
.book-title { font-weight: 600; }
.book p { margin: 0; }
footer { margin-top: 3rem; }
@media (max-width: 32rem) { .approve { grid-template-columns: 1fr; } .scan { display: none; } }
`;

export function renderPage(model: PageModel): string {
  const refresh = refreshSeconds(model);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh === null ? '' : `<meta http-equiv="refresh" content="${refresh}">`}
<title>${APP_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<header>${LOGO}<h1>${APP_NAME}</h1></header>
${model.listeners.length === 0 ? firstSignIn(model) : model.listeners.map((listener) => listenerSection(model, listener)).join('')}
${model.listeners.length === 0 ? '' : addListener(model)}
<footer><p class="soft small">Version ${APP_VERSION}</p></footer>
</main>
</body>
</html>`;
}

function refreshSeconds(model: PageModel): number | null {
  if (model.listeners.length === 0 || model.formProblem !== null || model.listeners.some((listener) => listener.state === 'signed-out')) {
    return null;
  }

  return model.listeners.some((listener) => listener.state === 'pairing') ? PAIRING_REFRESH_SECONDS : CONNECTED_REFRESH_SECONDS;
}

function firstSignIn(model: PageModel): string {
  return `<section class="card">
<h2>Sign in to Audiobookshelf</h2>
<p class="soft">Step 1 of 2. Use the account you listen with.</p>
${signInForm(model, model.formProblem?.address ?? model.foundAddress, 'Sign in')}
<p class="soft small actions">Your password goes to your own Audiobookshelf and is not kept. Seekquel never sees it.</p>
</section>`;
}

function signInForm(model: PageModel, address: string | null, action: string): string {
  const problem = model.formProblem === null ? '' : `<p class="problem" role="alert">${escape(model.formProblem.message)}</p>`;
  const known = address !== null && model.formProblem === null;
  const field = `<label for="address">Audiobookshelf address</label>
<input id="address" name="address" type="text" inputmode="url" required placeholder="http://192.168.1.10:13378" value="${escape(address ?? '')}">`;

  return `${problem}
<form method="post" action="/listeners">
${known ? `<p class="found"><span>Found your Audiobookshelf.</span></p><details><summary>Use a different address</summary>${field}</details>` : field}
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<p class="actions"><button class="button" type="submit">${action}</button></p>
</form>`;
}

function listenerSection(model: PageModel, listener: ListenerView): string {
  const title = listener.name === null ? listener.sourceName : `${escape(listener.name)} on ${listener.sourceName}`;

  return `<section class="listener">
<div class="listener-head"><h2>${title}</h2></div>
${listener.problem === null ? '' : `<p class="problem" role="alert">${escape(listener.problem)}</p>`}
${listenerBody(model, listener)}
${disconnect(listener)}
</section>`;
}

function listenerBody(model: PageModel, listener: ListenerView): string {
  if (listener.state === 'signed-out') {
    return `<div class="card"><h3>Sign in again</h3>${signInForm(model, listener.address, 'Sign in')}</div>`;
  }

  if (listener.state === 'pairing') {
    return pairing(listener);
  }

  return connected(model, listener);
}

function pairing(listener: ListenerView): string {
  if (listener.pairing === null) {
    return '<div class="card"><h3>Connect to Seekquel</h3><p class="soft">Step 2 of 2. Getting ready.</p></div>';
  }

  return `<div class="card">
<h3>Connect to Seekquel</h3>
<p class="soft">Step 2 of 2. Seekquel asks you to confirm, and this page updates by itself.</p>
<div class="approve">
<div>
<p><a class="button" href="${escape(listener.pairing.link)}" target="_blank" rel="noopener">Approve in Seekquel</a></p>
<p class="soft small">Or enter this code under Settings, Integrations, Another reading app:</p>
<p class="code">${escape(listener.pairing.userCode)}</p>
</div>
<div class="scan">
${qr(listener.pairing.link)}
<p class="soft small qr-note">Seekquel on your phone? Scan this.</p>
</div>
</div>
</div>`;
}

function connected(model: PageModel, listener: ListenerView): string {
  const checked = listener.lastSyncAt === null ? 'First check running' : `Checked ${ago(model.now, listener.lastSyncAt)}`;

  return `<div class="card">
<div class="listener-head">
<p class="soft">Logging to Seekquel. ${checked}.</p>
<form class="inline" method="post" action="/listeners/${listener.id}/check"><button class="button quiet plain" type="submit">Check now</button></form>
</div>
${
  listener.books.length === 0
    ? '<p>Play a book in Audiobookshelf and it shows up here.</p>'
    : `<ul class="books">${listener.books.map((book) => bookRow(model, listener, book)).join('')}</ul>`
}
</div>`;
}

function bookRow(model: PageModel, listener: ListenerView, book: BookView): string {
  const cover = book.hasCover
    ? `<img class="cover" src="/listeners/${listener.id}/covers/${encodeURIComponent(book.document)}" alt="" loading="lazy">`
    : `<span class="cover">${LOGO}</span>`;

  return `<li class="book">
${cover}
<div>
<p class="book-title">${escape(book.title)}</p>
${book.authors === null ? '' : `<p class="soft small">${escape(book.authors)}</p>`}
<p class="small">${bookLine(model, book)}</p>
</div>
</li>`;
}

function bookLine(model: PageModel, book: BookView): string {
  if (book.waiting) {
    return `Seekquel could not tell which book this is. <a href="${escape(model.waitingBooksLink)}" target="_blank" rel="noopener">Choose it in Seekquel</a> and its time is added.`;
  }

  const parts = [
    book.finished ? 'Finished' : book.percent === null ? null : `${book.percent}% through`,
    book.secondsToday > 0 ? `${duration(book.secondsToday)} today` : null,
    book.lastSentAt === null ? null : `sent ${ago(model.now, book.lastSentAt)}`,
  ].filter((part): part is string => part !== null);

  return `<span class="soft">${parts.join(' · ')}</span>`;
}

function disconnect(listener: ListenerView): string {
  return `<details>
<summary>Disconnect</summary>
<p class="soft small actions">Stops logging for this listener and forgets the sign-in. Books already in Seekquel stay. To finish, also remove Seekquel Bridge in Seekquel under Settings, Integrations.</p>
<form method="post" action="/listeners/${listener.id}/disconnect"><button class="button quiet plain" type="submit">Disconnect this listener</button></form>
</details>`;
}

function addListener(model: PageModel): string {
  return `<details${model.formProblem === null ? '' : ' open'}>
<summary>Add another listener</summary>
<div class="card">
<p class="soft">Someone else who listens on this server signs in here and connects their own Seekquel account.</p>
${signInForm(model, model.formProblem?.address ?? model.listeners[0]?.address ?? model.foundAddress, 'Add listener')}
</div>
</details>`;
}

function qr(link: string): string {
  const code = qrcode(0, 'M');

  code.addData(link);
  code.make();

  const size = code.getModuleCount();
  const span = size + QR_QUIET_MODULES * 2;
  let path = '';

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (code.isDark(row, column)) {
        path += `M${column + QR_QUIET_MODULES} ${row + QR_QUIET_MODULES}h1v1h-1z`;
      }
    }
  }

  return `<svg class="qr" viewBox="0 0 ${span} ${span}" role="img" aria-label="QR code that opens Seekquel to approve this connection"><path d="${path}"/></svg>`;
}

export function ago(now: number, then: number): string {
  const seconds = Math.max(0, Math.round((now - then) / MS_PER_SECOND));

  if (seconds < JUST_NOW_SECONDS) {
    return 'just now';
  }

  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);

  if (minutes < MINUTES_PER_HOUR) {
    return minutes <= 1 ? 'a minute ago' : `${minutes} minutes ago`;
  }

  const hours = Math.round(minutes / MINUTES_PER_HOUR);

  if (hours < HOURS_PER_DAY) {
    return hours <= 1 ? 'an hour ago' : `${hours} hours ago`;
  }

  const days = Math.round(hours / HOURS_PER_DAY);

  return days <= 1 ? 'yesterday' : `${days} days ago`;
}

export function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE));

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} min`;
  }

  const rest = minutes % MINUTES_PER_HOUR;

  return rest === 0 ? `${Math.floor(minutes / MINUTES_PER_HOUR)} h` : `${Math.floor(minutes / MINUTES_PER_HOUR)} h ${rest} min`;
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
