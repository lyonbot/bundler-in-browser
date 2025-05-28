const aliasEmptyObject = require.resolve('./dirty-stuff/empty-object.cjs');

const commonResolveAliases = {
  'path': require.resolve('./dirty-stuff/path.cjs'),
  'fs': require.resolve(aliasEmptyObject),
  'graceful-fs': require.resolve(aliasEmptyObject),
  'util': require.resolve('./dirty-stuff/util.js'),
}

exports.aliasEmptyObject = aliasEmptyObject;
exports.commonResolveAliases = commonResolveAliases;
