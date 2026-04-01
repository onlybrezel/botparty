import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Nav from '@/components/nav';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'BotParty', template: '%s | BotParty' },
  description: 'Drive real robots from your browser. WebRTC video, live controls, no setup needed.',
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
      <body className={`${inter.variable} min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased`}>
        <Nav />
        <main>{children}</main>
        <footer className="border-t border-[var(--border)] py-6 text-center text-sm text-[var(--muted-foreground)]">
          BotParty &mdash; MIT license &mdash;{' '}
          <a
            href="https://github.com"
            className="hover:text-[var(--foreground)] transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </footer>
      </body>
    </html>
  );
}
