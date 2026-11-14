import { HttpError, UnreachableError } from './http.js';
import { KeyRefusedError } from './seekquel.js';
import { SourceSignedOutError } from './sources/audiobookshelf.js';

const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

export function explain(error: unknown): string {
  if (error instanceof KeyRefusedError) {
    return 'Seekquel no longer has this connection. Approve it again below.';
  }

  if (error instanceof SourceSignedOutError) {
    return 'Audiobookshelf signed this listener out. Sign in again below.';
  }

  if (error instanceof UnreachableError) {
    return error.service === 'Seekquel'
      ? 'Seekquel could not be reached. Nothing is lost, and it will try again by itself.'
      : `${error.service} could not be reached. Check that it is running. It will try again by itself.`;
  }

  if (error instanceof HttpError && error.status === HTTP_TOO_MANY) {
    return `${error.service} asked for a short pause. It will carry on by itself.`;
  }

  if (error instanceof HttpError && error.status >= HTTP_SERVER_ERROR) {
    return `${error.service} had a problem on its side. Nothing is lost, and it will try again by itself.`;
  }

  if (error instanceof HttpError) {
    return `${error.service} refused a request (${error.status}). It will try again, and if this stays, update Seekquel Bridge.`;
  }

  return 'Something went wrong. It will try again by itself.';
}
