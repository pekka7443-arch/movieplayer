import { NextResponse } from 'next/server';
import { sportsChannels } from '@/lib/server/iptv';
import { apiError } from '@/lib/server/api';
import { requireAuthedUser } from '@/lib/server/auth';

/**
 * GET /api/sports/channels
 *   → { channels: SportsChannel[], count: number } | 502 iptv_unreachable
 *
 * Keyless free-to-air sports channels parsed from iptv-org's public
 * "Sports" M3U playlist (https-only streams, cached 6h server-side).
 * PHASE 2: channel list carries playable stream URLs → accounts only.
 */
export async function GET(request: Request) {
  const authed = await requireAuthedUser(request);
  if (!authed) return apiError(401, 'unauthorized');

  const channels = await sportsChannels();
  if (!channels) {
    return apiError(502, 'iptv_unreachable');
  }
  return NextResponse.json({ channels, count: channels.length });
}
