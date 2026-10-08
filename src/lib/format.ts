// Client-safe formatting helpers shared by the session/device UIs
// (settings → Security, admin → My sessions). No server imports — these run
// in the browser bundle.

/** Coarse device label from a raw userAgent string. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone / iPad';
  if (/android/i.test(userAgent)) return 'Android device';
  if (/macintosh/i.test(userAgent)) return 'Mac';
  if (/windows/i.test(userAgent)) return 'Windows PC';
  if (/linux/i.test(userAgent)) return 'Linux device';
  return 'Browser';
}

/** Coarse browser label from a raw userAgent string (mirrors server buckets). */
export function browserLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown';
  const v = userAgent.toLowerCase();
  if (v.includes('edg/')) return 'Edge';
  if (v.includes('opr/') || v.includes('opera')) return 'Opera';
  if (v.includes('samsungbrowser')) return 'Samsung Internet';
  if (v.includes('firefox')) return 'Firefox';
  if (v.includes('chrome') || v.includes('crios')) return 'Chrome';
  if (v.includes('safari')) return 'Safari';
  return 'Other';
}

/** Compact relative timestamp for "last seen" style columns. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
