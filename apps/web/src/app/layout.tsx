import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BotParty',
  description: 'Self-hosted robot teleoperation. Connect a Raspberry Pi and let people drive it from a browser.',
  keywords: ['robot', 'teleoperation', 'webrtc', 'livekit', 'remote control'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased">
        {children}
      </body>
    </html>
  );
}
