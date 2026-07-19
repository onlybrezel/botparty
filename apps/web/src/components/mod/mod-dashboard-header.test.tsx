import { Activity, Bot } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModDashboardHeader } from './mod-dashboard-header';

describe('ModDashboardHeader', () => {
  it('keeps refresh, attention shortcuts, metrics, traffic, and section navigation available', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onActiveViewChange = vi.fn();

    render(
      <ModDashboardHeader
        refreshing={false}
        onRefresh={onRefresh}
        overviewCards={[
          {
            key: 'robots',
            label: 'Online robots',
            value: 3,
            detail: 'Three robots are connected',
            accent: 'text-emerald-300',
            icon: Bot,
          },
        ]}
        actionItems={[
          {
            title: 'Review active restriction',
            detail: 'One restriction needs follow-up',
            view: 'moderation',
          },
        ]}
        generatedAt="2026-07-18T20:00:00.000Z"
        ingressKbps={1200}
        egressKbps={2400}
        activeView="moderation"
        onActiveViewChange={onActiveViewChange}
        viewButtons={[
          {
            id: 'moderation',
            label: 'Moderation',
            description: 'Review restrictions',
            icon: Activity,
          },
          {
            id: 'robots',
            label: 'Robots',
            description: 'Manage robots',
            icon: Bot,
          },
        ]}
      />,
    );

    expect(screen.getByText('Online robots')).toBeInTheDocument();
    expect(screen.getByText('1.2 Mbps')).toBeInTheDocument();
    expect(screen.getByText('2.4 Mbps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Moderation' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: /Review active restriction/ }));
    await user.click(screen.getByRole('button', { name: 'Robots' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onActiveViewChange).toHaveBeenNthCalledWith(1, 'moderation');
    expect(onActiveViewChange).toHaveBeenNthCalledWith(2, 'robots');
  });
});
