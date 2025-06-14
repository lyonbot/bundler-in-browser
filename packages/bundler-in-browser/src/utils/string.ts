export function escapeRegExp(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * given full path like `@lyonbot/bundler-in-browser/foo/bar.js`, 
 * 
 * return `['@lyonbot/bundler-in-browser', 'foo/bar.js']`
 */
export function pathToNpmPackage(fullPath: string): [packageName: string, importedPath: string] {
  let fullPathSplitted = fullPath.split('/', 2);
  let packageName = fullPath[0] === '@' ? fullPathSplitted.join('/') : fullPathSplitted[0];
  let importedPath = fullPath.slice(packageName.length + 1) // remove leading slash

  return [packageName, importedPath];
}

/**
 * given a name with version, like `foo@^1.2.3`, 
 * 
 * return `['foo', '^1.2.3']`
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
