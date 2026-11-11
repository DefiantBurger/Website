// Message board display logic, kept apart from api.ts (which reads import.meta.env) so it's unit-testable.

export interface BoardMessage {
  id: string;
  text: string;
  createdAt: string;
  expiresAt: string;
}

/** A message with its expiry on this device's clock, in epoch milliseconds. */
export type LiveMessage = BoardMessage & { expiresAtMs: number };

/**
 * Time each message's expiry on this device's clock. `serverTime` and `receivedAt` are
 * the same moment on the two clocks, so a skewed local clock neither hides new
 * messages nor keeps expired ones.
 */
export function withLocalExpiry(
  messages: BoardMessage[],
  serverTime: string,
  receivedAt: number,
): LiveMessage[] {
  const skew = receivedAt - Date.parse(serverTime);
  return messages.map((message) => ({
    ...message,
    expiresAtMs: Date.parse(message.expiresAt) + skew,
  }));
}

/** Whole seconds until `message` expires; 0 once it has. */
export function secondsLeft(message: LiveMessage, now: number): number {
  return Math.max(0, Math.ceil((message.expiresAtMs - now) / 1000));
}

/** Length as the server counts it: code points after NFC, so an emoji counts once, not twice. */
export function messageLength(text: string): number {
  return [...text.trim().normalize('NFC')].length;
}
