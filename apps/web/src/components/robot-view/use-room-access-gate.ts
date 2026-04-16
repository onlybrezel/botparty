import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';

interface UseRoomAccessGateOptions {
  robotId: string;
  inviteCode?: string;
}

/**
 * Custom hook to manage robot room access validation.
 * Handles password, invite code, and allowlist checks.
 */
export function useRoomAccessGate({ robotId, inviteCode }: UseRoomAccessGateOptions) {
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [accessPasswordInput, setAccessPasswordInput] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const allowListAccessAttemptedRef = { current: false };
  const linkOnlyAccessAttemptedRef = { current: false };

  // Try automatic access grant (no password, invite link, or allowlist)
  const tryAutoAccess = useCallback(async () => {
    setAccessLoading(true);
    try {
      const token = await api.grantRoomAccess(robotId, {
        inviteCode: inviteCode || undefined,
      });
      setRoomAccessToken(token);
      setAccessError(null);
    } catch (err: any) {
      const errorMsg = err?.message || 'Access denied';
      // Only show error if it's not a permission issue (user will see the manual form)
      if (!errorMsg.includes('password') && !errorMsg.includes('allowlist')) {
        setAccessError(errorMsg);
      }
    } finally {
      setAccessLoading(false);
    }
  }, [robotId, inviteCode]);

  // Submit password for access
  const submitPassword = useCallback(async (password: string) => {
    setAccessLoading(true);
    setAccessError(null);
    try {
      const token = await api.grantRoomAccess(robotId, {
        password,
        inviteCode: inviteCode || undefined,
      });
      setRoomAccessToken(token);
      setAccessPasswordInput('');
    } catch (err: any) {
      const message = err?.message || 'Access denied';
      setAccessError(message);
      pushToast(message, 'error');
    } finally {
      setAccessLoading(false);
    }
  }, [robotId, inviteCode]);

  return {
    roomAccessToken,
    accessPasswordInput,
    accessLoading,
    accessError,
    setAccessPasswordInput,
    tryAutoAccess,
    submitPassword,
    allowListAccessAttemptedRef,
    linkOnlyAccessAttemptedRef,
  };
}
