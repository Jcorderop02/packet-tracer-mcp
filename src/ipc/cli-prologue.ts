/** Prepare a configuration script for the CLI runner. The runner handles pagination. */
export function wrapInConfig(body: string): string {
  return ["enable", "configure terminal", "no ip domain-lookup", body, "end"].join("\n");
}
