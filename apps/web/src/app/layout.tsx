import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import './globals.css';
import { defaultLocale, localizePath } from '@/lib/i18n';
import Nav from '@/components/nav';
import { ThemeController } from '@/components/theme-controller';
import { ToastStack } from '@/components/ui/toast-stack';

export const metadata: Metadata = {
  metadataBase: new URL('https://botparty.live'),
  title: { default: 'BotParty', template: '%s | BotParty' },
  description: 'Watch, queue, and drive real internet-connected robots from your browser.',
  keywords: ['robot', 'teleoperation', 'webrtc', 'livekit', 'remote control', 'robotics'],
  icons: {
    icon: [
      { url: '/brand/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/brand/favicon-32x32.png',
    apple: '/brand/apple-touch-icon.png',
  },
  openGraph: {
    title: 'BotParty',
    description: 'Watch, queue, and drive real internet-connected robots from your browser.',
    type: 'website',
    url: 'https://botparty.live',
    siteName: 'BotParty',
    images: [
      {
        url: '/brand/og-default.png',
        width: 1200,
        height: 630,
        alt: 'BotParty robot social preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BotParty',
    description: 'Watch, queue, and drive real internet-connected robots from your browser.',
    images: ['/brand/og-default.png'],
  },
  manifest: '/manifest.webmanifest',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = defaultLocale;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {`(() => {
            try {
              const raw = window.localStorage.getItem('botparty.preferences.v2');
              const parsed = raw ? JSON.parse(raw) : null;
              const storedTheme = parsed?.state?.theme;
              const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
              const theme = storedTheme === 'dark' || storedTheme === 'light'
                ? storedTheme
                : (prefersLight ? 'light' : 'dark');
              document.documentElement.classList.remove('dark', 'light');
              document.documentElement.classList.add(theme);
              document.documentElement.dataset.theme = theme;
            } catch {
              document.documentElement.classList.add('dark');
              document.documentElement.dataset.theme = 'dark';
            }
          })();`}
        </Script>
      </head>
      <body className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)] antialiased">
        <noscript>
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            BotParty needs JavaScript for live video, chat, and robot controls.
          </div>
        </noscript>
        <ThemeController />
        <Nav />
        <ToastStack />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] bg-[var(--background)]/96">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div>
              <p className="font-semibold text-[var(--foreground)]">BotParty</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Link href={localizePath('/terms', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Terms of Service
              </Link>
              <Link href={localizePath('/privacy', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Privacy Policy
              </Link>
              <Link href={localizePath('/imprint', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Imprint
              </Link>
              <Link href={localizePath('/cookies', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Cookie Notice
              </Link>
              <Link href={localizePath('/status', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Status
              </Link>
              <Link href={localizePath('/docs/robot-setup', locale)} prefetch={false} className="transition hover:text-[var(--foreground)]">
                Robot Setup
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
