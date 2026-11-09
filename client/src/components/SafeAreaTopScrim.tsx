// Local replacement for the artifact SDK's SafeAreaTopScrim: a spacer the
// height of the device's top safe-area inset (notch / status bar), painted
// with the given background colour.
export function SafeAreaTopScrim({ backgroundColor }: { backgroundColor?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{ height: "env(safe-area-inset-top)", backgroundColor }}
    />
  );
}
