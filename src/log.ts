function p(n: number) {
  return n < 10 ? "0" + n : n;
}

export function log(...args: any[]) {
  const now = new Date();
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  console.log(time, ...args);
}
