const NUMERIC = /^\d+$/;

export function isNewer(candidate: string | null, current: string): boolean {
  const left = parse(candidate);
  const right = parse(current);

  if (left === null || right === null) {
    return false;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;

    if (a !== b) {
      return a > b;
    }
  }

  return false;
}

function parse(version: string | null): number[] | null {
  if (version === null) {
    return null;
  }

  const parts = version.trim().replace(/^v/i, '').split('.');

  return parts.every((part) => NUMERIC.test(part)) ? parts.map(Number) : null;
}
