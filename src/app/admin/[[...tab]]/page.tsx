import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { AdminDashboard } from '@/components/admin/dashboard';
import { SESSION_COOKIE, validateSessionToken } from '@/lib/server/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'CineDeck — Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// /admin/[[...tab]] — optional catch-all so every console section has a real
// URL: /admin, /admin/users, /admin/sessions, /admin/user-experience, …
// The slug is only a hint; the shell normalizes unknown values to Overview.
//
// SERVER-SIDE gate (2026-11-03 hardening): the console bundle is only served
// to signed-in administrators — non-admins get a static "restricted" page
// instead of the dashboard code. (Every /api/admin endpoint has always
// re-checked the role server-side; this stops the UI itself from being
// shipped to guests and members.)
export default async function AdminPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab } = await params;
  const slug = tab?.[0];

  let isAdmin = false;
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) {
      const session = await validateSessionToken(token);
      if (session?.role === 'admin') {
        const user = await db.user.findUnique({
          where: { id: session.userId },
          select: { role: true },
        });
        isAdmin = user?.role === 'admin';
      }
    }
  } catch {
    isAdmin = false;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Restricted area</h1>
          <p className="text-muted-foreground">
            This console is available to administrators only. Sign in with an
            administrator account to continue.
          </p>
        </div>
      </div>
    );
  }

  return <AdminDashboard initialTab={slug} />;
}
