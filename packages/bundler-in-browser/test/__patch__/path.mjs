import path from "path-browserify";
path.win32 = Object.assign(Object.create(path.posix), { sep: '\\' }); // for enhanced-resolve
export default path;
