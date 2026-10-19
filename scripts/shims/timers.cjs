// The sandbox has no timers; xml2js only touches setImmediate in async mode.
module.exports = {
  setImmediate: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  clearImmediate: () => {},
};
