// Minimal types for the dev-only `jpeg-js` decoder used by fixture tests.
declare module 'jpeg-js' {
  export function decode(
    data: Uint8Array,
    opts?: { useTArray?: boolean; formatAsRGBA?: boolean },
  ): { width: number; height: number; data: Uint8Array };
}
