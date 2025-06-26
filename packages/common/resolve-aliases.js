import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const aliasEmptyObject = require.resolve('./dirty-stuff/empty-object.cjs');

export const commonResolveAliases = {
  'path': require.resolve('./dirty-stuff/path.cjs'),
  'fs': require.resolve(aliasEmptyObject),
  'graceful-fs': require.resolve(aliasEmptyObject),
  'util': require.resolve('./dirty-stuff/util.js'),
}
