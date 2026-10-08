import type { ReactNode } from 'react';

import { AppProviders } from '@/components/site/app-providers';

// The console runs outside the site chrome, so it mounts the shared app
// providers (React Query, theme, sonner toaster) itself.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
