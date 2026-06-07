// jsdom does not implement HTMLMediaElement.play(); silence the "Not implemented" error
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
});
