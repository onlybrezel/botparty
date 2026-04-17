import type { ControlButtonAccess } from '@botparty/shared';
import type { ControlButtonRecord } from '../api-types';
import type { RequestFn } from './types';

function buildQueryString(params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : '';
}

export class ControlsApi {
  constructor(private readonly req: RequestFn) {}

  async getControls(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    return this.req<ControlButtonRecord[]>(
      `/controls/robot/${robotId}${buildQueryString({ roomAccessToken, guestSessionId })}`,
    );
  }

  async getAllControls(robotId: string) {
    return this.req<ControlButtonRecord[]>(`/controls/robot/${robotId}/all`);
  }

  async createControl(
    robotId: string,
    data: {
      label: string;
      command: string;
      hotKey?: string;
      icon?: string;
      cooldownMs?: number;
      access?: ControlButtonAccess;
      position?: number;
      isEnabled?: boolean;
      color?: string;
    },
  ) {
    return this.req<ControlButtonRecord>(`/controls/robot/${robotId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateControl(
    buttonId: string,
    data: {
      label?: string;
      command?: string;
      hotKey?: string;
      icon?: string;
      cooldownMs?: number;
      access?: ControlButtonAccess;
      position?: number;
      isEnabled?: boolean;
      color?: string | null;
    },
  ) {
    return this.req<ControlButtonRecord>(`/controls/${buttonId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteControl(buttonId: string) {
    return this.req(`/controls/${buttonId}`, { method: 'DELETE', expectNoContent: true });
  }

  async reorderControls(robotId: string, order: Array<{ id: string; position: number }>) {
    return this.req(`/controls/robot/${robotId}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
      expectNoContent: true,
    });
  }
}
