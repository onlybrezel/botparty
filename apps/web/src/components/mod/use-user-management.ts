import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';

export interface StaffUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits: number;
  balance: number;
  lastLoginAt: string | null;
}

export interface UserDraft {
  username: string;
  email: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits: string;
  balance: string;
}

/**
 * Custom hook for managing user admin operations in mod dashboard.
 * Handles user CRUD, filtering, and draft state.
 */
export function useUserManagement() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userSearchFilter, setUserSearchFilter] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setUserLoading(true);
    try {
      const fetchedUsers = await api.listUsers();
      setUsers(fetchedUsers);
      setUserError(null);
    } catch (err: any) {
      const message = err?.message || 'Failed to load users';
      setUserError(message);
      pushToast(message, 'error');
    } finally {
      setUserLoading(false);
    }
  }, []);

  const createUser = useCallback(
    async (draft: UserDraft) => {
      if (!draft.username?.trim() || !draft.email?.trim() || !draft.password?.trim()) {
        pushToast('Username, email, and password are required', 'error');
        return;
      }

      setUserLoading(true);
      try {
        const created = await api.createUser({
          username: draft.username,
          email: draft.email,
          displayName: draft.displayName || null,
          password: draft.password,
          role: draft.role,
          isActive: draft.isActive,
          credits: Number(draft.credits) || 0,
          balance: Number(draft.balance) || 0,
        });

        setUsers((prev) => [...prev, created]);
        setUserDraft(null);
        setEditingUserId(null);
        pushToast('User created successfully', 'success');
      } catch (err: any) {
        const message = err?.message || 'Failed to create user';
        setUserError(message);
        pushToast(message, 'error');
      } finally {
        setUserLoading(false);
      }
    },
    [],
  );

  const updateUser = useCallback(
    async (userId: string, draft: Partial<UserDraft>) => {
      setUserLoading(true);
      try {
        const updated = await api.updateUser(userId, {
          displayName: draft.displayName !== undefined ? (draft.displayName || null) : undefined,
          role: draft.role,
          isActive: draft.isActive,
          credits: draft.credits !== undefined ? Number(draft.credits) || 0 : undefined,
          balance: draft.balance !== undefined ? Number(draft.balance) || 0 : undefined,
        });

        setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
        setEditingUserId(null);
        setUserDraft(null);
        pushToast('User updated successfully', 'success');
      } catch (err: any) {
        const message = err?.message || 'Failed to update user';
        setUserError(message);
        pushToast(message, 'error');
      } finally {
        setUserLoading(false);
      }
    },
    [],
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      if (!confirm('Are you sure you want to delete this user?')) return;

      setUserLoading(true);
      try {
        await api.deleteUser(userId);
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        pushToast('User deleted successfully', 'success');
      } catch (err: any) {
        const message = err?.message || 'Failed to delete user';
        setUserError(message);
        pushToast(message, 'error');
      } finally {
        setUserLoading(false);
      }
    },
    [],
  );

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(userSearchFilter.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearchFilter.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(userSearchFilter.toLowerCase()),
  );

  return {
    users: filteredUsers,
    userLoading,
    userSearchFilter,
    setUserSearchFilter,
    editingUserId,
    setEditingUserId,
    userDraft,
    setUserDraft,
    userError,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
  };
}
