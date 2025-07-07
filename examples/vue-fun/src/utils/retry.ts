export async function retryUntil(fn: () => (boolean | Promise<boolean>), timeout = 1000): Promise<boolean> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await fn()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}
