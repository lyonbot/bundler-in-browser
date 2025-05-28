export function deprecate(fn, msg) {
  return function () {
    if (msg) { console.warn(msg); msg = null; }
    return fn.apply(this, arguments);
  };
}

export function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    })
  }
};
