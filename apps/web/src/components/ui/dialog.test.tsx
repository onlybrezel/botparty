import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './dialog';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <a href="/outside">Outside link</a>
      <Dialog
        open={open}
        title="Confirm action"
        description="Review the change before continuing."
        onClose={() => setOpen(false)}
      >
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
        <button type="button">Confirm</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('traps focus, makes the page inert, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });

    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Confirm action' });
    expect(dialog).toHaveAccessibleDescription('Review the change before continuing.');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(container.inert).toBe(true);
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(container.inert).not.toBe(true);
    expect(container).not.toHaveAttribute('aria-hidden');
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });
});
