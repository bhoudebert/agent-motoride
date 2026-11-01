/** The link a phone opens to join a server: the app asks the rider before it uses it (ADR 0029). */
export function inviteLink(base: string, code: string): string {
  return `mobilemotoride://server?url=${encodeURIComponent(base.replace(/\/+$/, ""))}&code=${code}`;
}
