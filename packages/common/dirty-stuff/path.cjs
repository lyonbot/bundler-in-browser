const path = require("path-browserify");
path.win32 = Object.assign(Object.create(path.posix), { sep: '\\' }); // for enhanced-resolve
module.exports = path;
