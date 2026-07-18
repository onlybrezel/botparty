import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardSidebar } from './dashboard-sidebar';

const robots = [
  {
    id: 'robot-1',
    name: 'Mars Rover',
    slug: 'mars-rover',
    status: 'ONLINE',
  },
  {
    id: 'robot-2',
    name: 'Claw Bot',
    slug: 'claw-bot',
    status: 'OFFLINE',
  },
] as const;

describe('DashboardSidebar', () => {
  it('supports keyboard navigation across robots, sections, and actions', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSectionSelect = vi.fn();
    const onDelete = vi.fn();

    render(
      <DashboardSidebar
        robots={robots as never}
        selectedId="robot-1"
        activeSectionId="section-settings"
        saving={false}
        deleting={false}
        editFormRef={{ current: { requestSubmit: vi.fn() } } as never}
        onSelect={onSelect}
        onSectionSelect={onSectionSelect}
        onDelete={onDelete}
      />,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Select robot Mars Rover' })).toHaveFocus();

    await user.tab();
    const secondRobotButton = screen.getByRole('button', { name: 'Select robot Claw Bot' });
    expect(secondRobotButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('robot-2');

    await user.tab();
    const settingsButton = screen.getByRole('button', { name: 'Jump to Settings section' });
    expect(settingsButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSectionSelect).toHaveBeenCalledWith('section-settings');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Jump to Token & Links section' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Jump to Controls section' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Jump to Operations section' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Jump to Webhooks section' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Jump to Monitoring section' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();

    await user.tab();
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
