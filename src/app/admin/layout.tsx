import type { ReactNode } from 'react';

import { AppProviders } from '@/components/site/app-providers';

// The console runs outside the site chrome, so it mounts the shared app
// providers (React Query, theme, sonner toaster) itself. The theme bootstrap
// is server-rendered in the ROOT layout head (nonce'd there) and the theme
// provider is script-free — nothing needs an x-nonce here anymore.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
