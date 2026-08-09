import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RobotChatPanel } from './chat-panel';
import type { ChatMsg } from './types';

const baseMessages: ChatMsg[] = [
  {
    userId: 'user-1',
    username: 'alpha',
    content: 'hello world',
    timestamp: Date.now(),
    isSystem: false,
  },
];

describe('RobotChatPanel', () => {
  it('renders the accessible chat input and submits on Enter', () => {
    const setChatInput = vi.fn();
    const onSend = vi.fn();

    render(
      <RobotChatPanel
        messages={baseMessages}
        hasOlderMessages={false}
        historyLoading={false}
        chatInput="hello"
        setChatInput={setChatInput}
        chatRestriction={null}
        focusMode="chat"
        currentViewerId="viewer-1"
        canModerate={false}
        moderatingUserId={null}
        chatScrollRef={createRef()}
        chatPanelRef={createRef()}
        chatInputRef={createRef()}
        chatShouldStickRef={{ current: true }}
        onLoadOlder={vi.fn()}
        onSend={onSend}
        onModerate={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Chat message input' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('shows moderation controls and restriction copy when enabled', () => {
    render(
      <RobotChatPanel
        messages={baseMessages}
        hasOlderMessages={false}
        historyLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatRestriction="Slow mode is active"
        focusMode="controls"
        currentViewerId="viewer-2"
        canModerate
        moderatingUserId={null}
        chatScrollRef={createRef()}
        chatPanelRef={createRef()}
        chatInputRef={createRef()}
        chatShouldStickRef={{ current: true }}
        onLoadOlder={vi.fn()}
        onSend={vi.fn()}
        onModerate={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Timeout' })).toBeInTheDocument();
    expect(screen.getByText('Slow mode is active')).toBeInTheDocument();
  });

  it('shows a load older button when paginated history is available', () => {
    const onLoadOlder = vi.fn();

    render(
      <RobotChatPanel
        messages={baseMessages}
        hasOlderMessages
        historyLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatRestriction={null}
        focusMode="chat"
        currentViewerId="viewer-1"
        canModerate={false}
        moderatingUserId={null}
        chatScrollRef={createRef()}
        chatPanelRef={createRef()}
        chatInputRef={createRef()}
        chatShouldStickRef={{ current: true }}
        onLoadOlder={onLoadOlder}
        onSend={vi.fn()}
        onModerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not execute HTML/script payloads coming from chat content', () => {
    const xssMessages: ChatMsg[] = [
      {
        userId: 'attacker',
        username: 'mallory',
        content: '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>',
        timestamp: Date.now(),
        isSystem: false,
      },
    ];

    const { container } = render(
      <RobotChatPanel
        messages={xssMessages}
        hasOlderMessages={false}
        historyLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatRestriction={null}
        focusMode="chat"
        currentViewerId="viewer-1"
        canModerate={false}
        moderatingUserId={null}
        chatScrollRef={createRef()}
        chatPanelRef={createRef()}
        chatInputRef={createRef()}
        chatShouldStickRef={{ current: true }}
        onLoadOlder={vi.fn()}
        onSend={vi.fn()}
        onModerate={vi.fn()}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect('__pwned' in window).toBe(false);
    expect(screen.getByText(/<img src=x onerror/)).toBeInTheDocument();
  });
});
