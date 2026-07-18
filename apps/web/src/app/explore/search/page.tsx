import type { Metadata } from 'next';
import { ExploreResults, type ExploreParams } from '../explore-results';

export const metadata: Metadata = {
  title: 'Search Robot Rooms',
  alternates: { canonical: '/explore' },
  robots: { index: false, follow: true },
};

export default async function ExploreSearchPage({
  searchParams,
}: {
  searchParams: Promise<ExploreParams>;
}) {
  return <ExploreResults params={await searchParams} />;
}
