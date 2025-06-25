/// <reference lib="webworker" />

import { sendCommandAndExecute } from "./rpc-port.js";

declare const __FS_CONSTANTS__: any
declare const self: DedicatedWorkerGlobalScope & { fs: any, __patchFs__: any }

const baseFs = {
  constants: __FS_CONSTANTS__,
} as any
const patchedKeys = ['write', 'stat', 'open', 'fstat', 'readdir', 'close', 'lstat', 'readlink'] // no read, see below
for (const method of patchedKeys) {
  baseFs[method] = function (...args: any[]) {
    const callback = args.pop()
    sendCommandAndExecute((payload, transferable) => {
      postMessage({ type: '__fs__', method, payload }, transferable);
    }, args).then(res => {
      // fix @zenfs/core bug
      if (res.length === 1) res[1] = null;
      if (res[0] === undefined) res[0] = null;

      // add missing methods for stat result
      if (res[1] && method.endsWith('stat')) res[1] = patchStatResult(res[1]);

      if (typeof callback === 'function') callback(...res);
    })
  }
}
// read is special, because once buffer is sent, it will be detached from here, and unable to recover.
baseFs.read = function (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: any) {
  if (!length) length = buffer.byteLength;
  sendCommandAndExecute((payload, transferable) => {
    postMessage({ type: '__fs__', method: 'read', payload }, transferable);
  }, [fd, new Uint8Array(length), 0, length, position]).then(res => {
    const n = res[1]
    if (res[0]) return callback(res[0], n); // error

    const outBuf = res[2] as Uint8Array
    buffer.subarray(offset, offset + n).set(outBuf.subarray(0, n))
    callback(null, n)
  })
}

// prepare the global `fs` for esbuild to read and populate
self.fs = { ...baseFs }
self.__patchFs__ = (fs: any) => {
  // at this moment, esbuild already patched writeSync and read
  const esbuildFsRead = fs.read;
  const esbuildFsWriteSync = fs.writeSync;

  // patch back read, write
  fs.read = function (fd: number, ...args: any[]) {
    if (fd === 0) return esbuildFsRead(fd, ...args);
    return baseFs.read(fd, ...args);
  }
  fs.write = function (fd: number, ...args: any[]) {
    if (fd === 1 || fd === 2) {
      // forward to esbuild's
      const callback = args.pop();
      try {
        callback(null, esbuildFsWriteSync(fd, ...args));
      } catch (e) {
        callback(e, 0);
      }
    } else {
      return baseFs.write(fd, ...args);
    }
  }

  self.__patchFs__ = () => { }
}

/** 
 * add missing methods for stat result 
 * 
 * also refer to https://go.dev/src/syscall/fs_js.go - setStat
 */
function patchStatResult(stat: any) {
  const mode = stat.mode & baseFs.constants.S_IFMT
  stat.isDirectory = () => mode === baseFs.constants.S_IFDIR
  stat.isFile = () => mode === baseFs.constants.S_IFREG
  stat.isBlockDevice = () => mode === baseFs.constants.S_IFBLK
  stat.isCharacterDevice = () => mode === baseFs.constants.S_IFCHR
  stat.isSymbolicLink = () => mode === baseFs.constants.S_IFLNK
  stat.isFIFO = () => mode === baseFs.constants.S_IFIFO
  stat.isSocket = () => mode === baseFs.constants.S_IFSOCK
  return stat
}

// then concat original code

// onmessage = (function (postMessage) {
//   ... go wasm runtime
//   ... https://github.com/evanw/esbuild/blob/main/lib/shared/worker.ts
// })(postMessage)
