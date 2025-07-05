export const hi = () => 'hi' as const

export function makeError() {
  throw new Error('uh on error')
}
