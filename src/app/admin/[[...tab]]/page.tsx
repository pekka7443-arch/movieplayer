import type { Metadata } from 'next';

import { AdminDashboard } from '@/components/admin/dashboard';

export const metadata: Metadata = {
  title: 'CineDeck — Admin',
  robots: { index: false, follow: false },
};

// /admin/[[...tab]] — optional catch-all so every console section has a real
// URL: /admin, /admin/users, /admin/sessions, /admin/user-experience, …
// The slug is only a hint; the shell normalizes unknown values to Overview.
export default async function AdminPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab } = await params;
  const slug = tab?.[0];
  return <AdminDashboard initialTab={slug} />;
}
