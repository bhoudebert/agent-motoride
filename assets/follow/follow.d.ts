export interface FollowedPoint {
  v: 1;
  lat: number;
  lon: number;
  seq: number;
  at: number;
  spd?: number | null;
  hdg?: number | null;
  acc?: number | null;
  state?: "riding" | "stopped" | "ended" | "alert";
  name?: string;
  [key: string]: unknown;
}
export function importKey(fragment: string): Promise<CryptoKey | null>;
export function decryptUpdate(
  key: CryptoKey,
  channel: string,
  update: { seq: number; at: number; iv: string; ct: string },
): Promise<FollowedPoint | null>;
export function summarise(
  points: Array<{ at: number; state?: string }>,
  state: "live" | "ended",
  now: number,
): { headline: string; ageS: number | null; stale: boolean; alert?: boolean };
export function ago(seconds: number | null): string;
