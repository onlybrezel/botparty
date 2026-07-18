import type { Metadata } from 'next';
import { ExploreResults } from './explore-results';

export const metadata: Metadata = {
  title: 'Explore Robots',
  description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
  openGraph: {
    title: 'Explore Robots — BotParty',
    description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Explore Robots — BotParty',
    description: 'Browse live robot rooms, watch what is online, and jump into the queue.',
  },
};

export const revalidate = 30;

export default function ExplorePage() {
  return <ExploreResults params={{}} />;
}
