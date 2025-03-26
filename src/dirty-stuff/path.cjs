const path = require("path-browserify");
path.win32 = path.posix; // for enhanced-resolve
module.exports = path;
