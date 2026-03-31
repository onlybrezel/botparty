import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BotParty – Control Robots Live',
  description:
    'The modern teleoperation platform. Connect your robot, share it with the world, and let anyone control it in real-time with ultra-low latency.',
  keywords: ['robot', 'teleoperation', 'webrtc', 'livekit', 'remote control', 'live streaming'],
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
