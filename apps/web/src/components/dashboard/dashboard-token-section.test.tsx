import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RobotManaged } from '@/lib/api';
import { DashboardTokenSection } from './dashboard-token-section';

const robot = {
  id: 'robot-1',
  name: 'Test Robot',
  slug: 'test-robot',
  claimToken: null,
  streamKey: null,
} as unknown as RobotManaged;

describe('DashboardTokenSection', () => {
  it('keeps token actions safe when an update response does not include the secret', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();

    render(
      <DashboardTokenSection
        robot={robot}
        showToken={false}
        regenerating={false}
        embedCode="<iframe />"
        onToggleVisibility={vi.fn()}
        onCopyToken={vi.fn()}
        onCopyEmbedCode={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText('Not available')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Toggle token visibility' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Regenerate token' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
