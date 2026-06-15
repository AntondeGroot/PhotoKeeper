// jsdom does not implement HTMLMediaElement.play(); silence the "Not implemented" error
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
});

// The test environment does not provide localStorage; supply a minimal in-memory shim so code
// that persists to localStorage (LightroomService auth token, AppComponent settings) can run.
class LocalStorageMock implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new LocalStorageMock(),
});
