import "./globals.css";
import ScrollToTopButton from "./components/ScrollToTopButton";
import ScrollReset from "./components/ScrollReset";
import AnalyticsInitializer from "./components/AnalyticsInitializer";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import { AuthProvider } from "@/lib/hooks/useAuth";
import Nav from "@/components/layout/Nav";
import { createClient } from "@/lib/supabase/server";
import {
  isAiEndpointsEnabled,
  isGameModeEnabled,
  isParentLinkingV2Enabled,
  isParentPortalEnabled,
} from "@/lib/config/featureFlags";

export const metadata = {
  metadataBase: new URL('https://maturiraj.hr'),
  title: {
    default: 'Maturiraj.hr · Pripreme za državnu maturu',
    template: '%s · Maturiraj.hr',
  },
  description: 'Najbolja platforma za pripremu državne mature — skripte, simulatori, AI profesor.',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0F0605',
};

async function getParentWorkspaceUserId() {
  const allowedEmail = process.env.DEV_BYPASS_EMAIL;
  if (!isParentLinkingV2Enabled() || !allowedEmail) return null;

  // Keep this navigation signal aligned with the current /roditelji/* proxy guard.
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    return !error && user?.email === allowedEmail ? user.id : null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }) {
  const navigationFlags = {
    ai: isAiEndpointsEnabled(),
    game: isGameModeEnabled(),
    parent: isParentPortalEnabled(),
    parentWorkspaceUserId: await getParentWorkspaceUserId(),
  };

  return (
    <html lang="hr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;0,9..144,900;1,9..144,700&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:ital,wght@0,400;0,500;1,400&subset=latin,latin-ext&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          <Nav noCountdown sitewide flags={navigationFlags} />
          <AnalyticsInitializer />
          <ServiceWorkerRegistrar />
          <ScrollReset />
          {children}
          <ScrollToTopButton />
        </AuthProvider>
      </body>
    </html>
  );
}
