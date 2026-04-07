import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';
import Nav from '@/components/nav';
import { ToastStack } from '@/components/ui/toast-stack';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://botparty.live'),
  title: { default: 'BotParty', template: '%s | BotParty' },
  description: 'Drive real robots from your browser.',
  keywords: ['robot', 'teleoperation', 'webrtc', 'livekit', 'remote control', 'robotics'],
  openGraph: {
    title: 'BotParty',
    description: 'Drive real robots from your browser.',
    type: 'website',
    url: 'https://botparty.live',
    siteName: 'BotParty',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)] antialiased`}>
        <Nav />
        <ToastStack />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] bg-[var(--background)]/96">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div>
              <p className="font-semibold text-[var(--foreground)]">BotParty</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Link href="/terms" className="transition hover:text-[var(--foreground)]">
                Terms of Service
              </Link>
              <Link href="/privacy" className="transition hover:text-[var(--foreground)]">
                Privacy Policy
              </Link>
              <Link href="/cookies" className="transition hover:text-[var(--foreground)]">
                Cookie Notice
              </Link>
              <Link href="/docs" className="transition hover:text-[var(--foreground)]">
                Docs
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
