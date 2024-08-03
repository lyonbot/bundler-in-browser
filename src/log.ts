import dayjs from "dayjs";

export function log(...args: any[]) {
  console.log(dayjs().format(), ...args);
}
