import dayjs from "dayjs";

export function decodeUTF8(buf: Uint8Array) {
  return new TextDecoder().decode(buf);
}

export function encodeUTF8(str: string) {
  return new TextEncoder().encode(str);
}

export function chunked<T>(arr: T[], size: number) {
  let res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

export function memoAsync<A extends any[], T>(fn: (...args: A) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  const toCacheKey = (args: A) => JSON.stringify(args);

  return async (...args: A) => {
    let key = toCacheKey(args);
    let cached = cache.get(key);
    if (cached) return cached;

    cached = fn(...args);
    cache.set(key, cached);
    return cached;
  }
}

export function log(...args: any[]) {
  console.log(dayjs().format(), ...args);
}
