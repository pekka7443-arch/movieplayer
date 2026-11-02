import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { AppProviders } from '@/components/site/app-providers';

// The console runs outside the site chrome, so it mounts the shared app
// providers (React Query, theme, sonner toaster) itself. The CSP nonce is
// threaded from the proxy middleware so next-themes' inline bootstrap script
// survives the strict-dynamic production CSP.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cspNonce = (await headers()).get('x-nonce') ?? undefined;
  return <AppProviders cspNonce={cspNonce}>{children}</AppProviders>;
}
