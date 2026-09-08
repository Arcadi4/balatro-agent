interface ToggleHandle {
  enable(): void
  disable(): void
}

// Availability switch for the live-game surface. Tools and resources are
// registered up front but disabled until the `connect` tool establishes the
// game session; a dropped session disables them again. The SDK hides
// disabled entries from tools/list and resources/list and rejects calls to
// them, so clients only ever see the game surface while it can answer.
export class GameGate {
  private readonly handles: ToggleHandle[] = []
  private active = false

  track(handle: ToggleHandle): void {
    this.handles.push(handle)
    handle.disable()
  }

  // Sets the gate state unconditionally; used once after registration so a
  // new MCP session over an already-attached bridge starts enabled.
  sync(enabled: boolean): void {
    this.active = enabled
    for (const handle of this.handles) {
      if (enabled) handle.enable()
      else handle.disable()
    }
  }

  enable(): void {
    if (this.active) return
    this.sync(true)
  }

  disable(): void {
    if (!this.active) return
    this.sync(false)
  }
}
