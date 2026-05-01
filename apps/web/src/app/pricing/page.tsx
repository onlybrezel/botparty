import type { Metadata } from 'next';
import { PricingPage } from '@/components/pricing/pricing-page';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Buy BotParty credits with card or PayPal.',
};

export default function PricingRoute() {
  return <PricingPage />;
}
