export function escapeRegExp(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * given full path like `@lyonbot/bundler-in-browser/foo/bar.js`, 
 * 
 * return `['@lyonbot/bundler-in-browser', 'foo/bar.js']`
 */
export function pathToNpmPackage(fullPath: string): [packageName: string, importedPath: string] {
  let fullPathSplitted = fullPath.indexOf('/');
  if (fullPath[0] === '@' && fullPathSplitted !== -1) fullPathSplitted = fullPath.indexOf('/', fullPathSplitted + 1);  // handle `@foo/bar/baz`
  if (fullPathSplitted === -1) return [fullPath, ''];

  const packageName = fullPath.slice(0, fullPathSplitted);
  const importedPath = fullPath.slice(fullPathSplitted + 1);

  return [packageName, importedPath];
}

/**
 * given a name with version, like `foo@^1.2.3`, 
 * 
 * return `['foo', '^1.2.3']` or like [`@foo/bar', '^1.2.3']`
 */
export function separateNpmPackageNameVersion(nameWithVersion: string, defaultVersion = 'latest'): [packageName: string, version: string] {
  const atIndex = nameWithVersion.indexOf('@', 1);
  if (atIndex !== -1) {
    return [nameWithVersion.slice(0, atIndex), nameWithVersion.slice(atIndex + 1)];
  }
  return [nameWithVersion, defaultVersion];
}

/**
 * remove query string from path. eg: `/foo/bar.js?foo=bar` -> `/foo/bar.js`
 */
export const stripQuery = (path: string) => {
  const queryIndex = path.indexOf('?');
  if (queryIndex !== -1) return path.slice(0, queryIndex);
  return path;
}

/** 
 * wrap a commonjs `code` into a IIFE expression. its value is exactly what `module.exports` is.
 * 
 * if your code relies on `require()`, you must add it before the IIFE expression. see example below.
 * 
 * @example
 * ```
 * const code = `exports.foo = "hello " + require('fourty-two')`
 * 
 * const output = `
 *   // concatenated code
 *   var require = (id) => 42;   // mocked require() always return 42
 *   var mod1 = ${wrapCommonJS(code)};
 *   console.log(mod1.foo);
 * `
 * eval(output); // "hello 42"
 * ```
 */
export function wrapCommonJS(code: string, module = '{exports:{}}') {
  return `((module => ((exports=>{${code}\n})(module.exports), module.exports))(${module}))`
}

/**
 * convert a `(string | RegExp)[]` to a function, which will return true if the string matches any of the RegExp.
 * 
 * useful for configurations like `externals` and `blocklist`.
 * 
 * @returns 
 */
export function listToTestFn(list: (string | RegExp)[]): (str: string) => boolean {
  if (!Array.isArray(list)) list = [list];

  const strSet = new Set<string>();
  const regex: RegExp[] = [];

  for (const item of list) {
    if (typeof item === 'string') {
      strSet.add(item);
    } else if (item instanceof RegExp) {
      regex.push(item);
    }
  }

  if (!regex.length) return (str) => strSet.has(str);

  return (str) => {
    if (strSet.has(str)) return true;
    for (const r of regex) if (r.test(str)) return true;
    return false;
  }
}

/**
 * encode string to base64. support UTF-8 string.
 */
export function toBase64(str: string) {
  try {
    return btoa(str);
  } catch {
    // maybe contains non-latin characters.
    const utf8Bytes = new TextEncoder().encode(str);
    const binaryString = String.fromCharCode(...utf8Bytes);
    return btoa(binaryString);
  }
}

/**
 * decode base64 string. support UTF-8 string.
 */
export function fromBase64(str: string) {
  const raw = atob(str);
  const rawLength = raw.length;
  const array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return new TextDecoder().decode(array);
}

/**
 * equals to `str.split(sep).length - 1`
 */
export function countChar(str: string, sep: string) {
  let count = 0;
  let i = 0;
  while ((i = str.indexOf(sep, i)) !== -1) {
    count++;
    i += sep.length;
  }
  return count;
}

/**
 * get a 1-based line number and column number, from `content` at `offset`.
 */
export function offsetToPosition(content: string, offset: number) {
  let lineStart = 0;
  let line = 1;
  let lineEnd = content.length;

  while (true) {
    lineEnd = content.indexOf('\n', lineStart);

    if (lineEnd === -1) { lineEnd = content.length; break; }
    if (offset <= lineEnd) break;

    line++;
    lineStart = lineEnd + 1;
  }

  return {
    line,
    column: offset - lineStart,
    lineText: content.slice(lineStart, lineEnd)
  }
}

/**
 * @param content 
 * @param line start from 1
 */
export function getLineText(content: string, line: number) {
  if (!content || !(line >= 1)) return '';

  let lineStart = 0;
  let lineEnd = content.length;

  while (true) {
    lineEnd = content.indexOf('\n', lineStart);

    if (lineEnd === -1) { lineEnd = content.length; break; }
    if (line <= 1) break;

    line--;
    lineStart = lineEnd + 1;
  }

  return content.slice(lineStart, lineEnd)
}
