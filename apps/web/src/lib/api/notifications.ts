import type { RequestFn } from './types';
import type { NotificationPreferenceRecord, NotificationRecord } from '@botparty/shared';
export type { NotificationPreferenceRecord, NotificationRecord } from '@botparty/shared';

export class NotificationsApi {
  constructor(private readonly req: RequestFn) {}

  list(cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.req<{ items: NotificationRecord[]; nextCursor: string | null; unreadCount: number }>(
      `/notifications${query}`,
    );
  }

  markRead(id: string) {
    return this.req<{ success: true }>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }

  markAllRead() {
    return this.req<{ success: true }>('/notifications/read-all', { method: 'POST', body: '{}' });
  }

  preferences() {
    return this.req<NotificationPreferenceRecord>('/notifications/preferences');
  }

  updatePreferences(input: Partial<NotificationPreferenceRecord>) {
    return this.req<NotificationPreferenceRecord>('/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
}
