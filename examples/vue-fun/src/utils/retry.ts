import type { Nil } from "yon-utils";

type MaybePromise<T> = T | Promise<T>;

export async function retryUntil<T>(fn: () => MaybePromise<Nil | false | T>, timeout = 1000): Promise<T | undefined> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const val = await fn()
    if (val) return val
    await new Promise(r => setTimeout(r, 100))
  }
}
