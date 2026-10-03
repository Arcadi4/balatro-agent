const NO_AUTO_CONTEXT_FLAG = "--no-auto-context"

/**
 * Every mutating command is followed by a settled-state read so the caller can
 * act on the next surface without reading again. Clients that poll the state
 * themselves, or that cannot afford the settle poll, turn the feed off at launch.
 */
export function autoContextEnabled(argv: readonly string[] = process.argv): boolean {
  return !argv.includes(NO_AUTO_CONTEXT_FLAG)
}
