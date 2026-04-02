import type { Metadata } from 'next';
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
  title: { default: 'BotParty', template: '%s | BotParty' },
  description: 'Drive real robots from your browser.',
  keywords: ['robot', 'teleoperation', 'webrtc', 'livekit', 'remote control', 'robotics'],
  openGraph: {
    title: 'BotParty',
    description: 'Drive real robots from your browser.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)] antialiased`}>
        <Nav />
        <ToastStack />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] py-6 text-center text-sm text-[var(--muted-foreground)]">
          BotParty
        </footer>
      </body>
    </html>
  );
}
