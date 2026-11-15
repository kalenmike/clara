/**
 * The web build replaces `@clara/lab` with this stub. The lab is a desktop-only
 * surface, so the deployed web artifact must not contain any lab code.
 */
export function LabApp(): null {
  return null
}

export function configureLabApi(): void {
  // No lab transport exists outside the desktop build.
}
