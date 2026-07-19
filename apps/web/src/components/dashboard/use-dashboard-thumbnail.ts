'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type RobotManaged } from '@/lib/api';
import { pushToast } from '@/lib/toast';

async function waitForRenderableVideoFrame(
  video: HTMLVideoElement,
  timeoutMs = 4000,
): Promise<boolean> {
  if (
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;
    let animationFrameId: number | null = null;
    let frameRequestId: number | null = null;

    const hasRenderableFrame = () =>
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;

      if (timeoutId) window.clearTimeout(timeoutId);
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      if (frameRequestId !== null && 'cancelVideoFrameCallback' in video) {
        (
          video as HTMLVideoElement & {
            cancelVideoFrameCallback?: (handle: number) => void;
          }
        ).cancelVideoFrameCallback?.(frameRequestId);
      }

      video.removeEventListener('loadeddata', checkReady);
      video.removeEventListener('playing', checkReady);
      video.removeEventListener('resize', checkReady);
      resolve(value);
    };

    const checkReady = () => {
      if (hasRenderableFrame()) finish(true);
    };

    timeoutId = window.setTimeout(() => finish(hasRenderableFrame()), timeoutMs);
    video.addEventListener('loadeddata', checkReady);
    video.addEventListener('playing', checkReady);
    video.addEventListener('resize', checkReady);

    if ('requestVideoFrameCallback' in video) {
      frameRequestId = (
        video as HTMLVideoElement & {
          requestVideoFrameCallback: (callback: () => void) => number;
        }
      ).requestVideoFrameCallback(checkReady);
    } else {
      const poll = () => {
        if (settled) return;
        if (hasRenderableFrame()) {
          finish(true);
          return;
        }
        animationFrameId = window.requestAnimationFrame(poll);
      };
      animationFrameId = window.requestAnimationFrame(poll);
    }

    checkReady();
  });
}

type ThumbnailOperation = 'upload' | 'snapshot' | 'remove' | null;

type Options = {
  accessToken: string | null;
  selectedRobot: RobotManaged | null;
  previewAvailable: boolean;
  onRobotUpdated: (robot: RobotManaged) => void;
  setError: (message: string | null) => void;
  setStatus: (message: string | null) => void;
};

export function useDashboardThumbnail({
  accessToken,
  selectedRobot,
  previewAvailable,
  onRobotUpdated,
  setError,
  setStatus,
}: Options) {
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const autoThumbnailAttemptedRef = useRef<Set<string>>(new Set());
  const [thumbnailOp, setThumbnailOp] = useState<ThumbnailOperation>(null);

  const updateThumbnailFromDataUrl = useCallback(
    async (dataUrl: string, mode: Exclude<ThumbnailOperation, 'remove' | null>) => {
      if (!accessToken || !selectedRobot) return;

      setThumbnailOp(mode);
      setError(null);
      setStatus(null);

      try {
        api.setToken(accessToken);
        const updated = await api.robots.uploadRobotThumbnail(selectedRobot.id, dataUrl);
        onRobotUpdated(updated);
        setStatus(
          mode === 'snapshot' ? 'Thumbnail captured from the live preview.' : 'Thumbnail uploaded.',
        );
        pushToast(
          mode === 'snapshot' ? 'Thumbnail captured.' : 'Thumbnail uploaded.',
          'success',
          2600,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update thumbnail';
        setError(message);
        pushToast(message, 'error', 3200);
      } finally {
        setThumbnailOp(null);
      }
    },
    [accessToken, onRobotUpdated, selectedRobot, setError, setStatus],
  );

  const handleThumbnailFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        pushToast('Please choose an image file.', 'error', 2600);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        if (!result) {
          pushToast('Could not read that image file.', 'error', 2600);
          return;
        }

        const image = new window.Image();
        image.onload = () => {
          const maxDimension = 1280;
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            pushToast('Could not prepare that image.', 'error', 2600);
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          void updateThumbnailFromDataUrl(canvas.toDataURL('image/jpeg', 0.82), 'upload');
        };
        image.onerror = () => pushToast('Could not decode that image file.', 'error', 2600);
        image.src = result;
      };
      reader.onerror = () => pushToast('Could not read that image file.', 'error', 2600);
      reader.readAsDataURL(file);
    },
    [updateThumbnailFromDataUrl],
  );

  const capturePreviewThumbnail = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (
        !selectedRobot ||
        (selectedRobot.status !== 'ONLINE' && selectedRobot.status !== 'BUSY')
      ) {
        if (!silent) pushToast('The robot must be live to capture a snapshot.', 'error', 2600);
        return;
      }

      const video = previewContainerRef.current?.querySelector('video') ?? null;
      if (!video) {
        if (!silent) pushToast('No live camera frame is available yet.', 'error', 2600);
        return;
      }

      const frameReady = await waitForRenderableVideoFrame(video);
      if (!frameReady || video.videoWidth <= 0 || video.videoHeight <= 0) {
        if (!silent) {
          pushToast('No rendered live camera frame is available yet.', 'error', 2600);
        }
        return;
      }

      const canvas = document.createElement('canvas');
      const maxDimension = 1280;
      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        if (!silent) {
          pushToast('Snapshot capture is not available in this browser.', 'error', 2600);
        }
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      await updateThumbnailFromDataUrl(canvas.toDataURL('image/jpeg', 0.82), 'snapshot');
    },
    [selectedRobot, updateThumbnailFromDataUrl],
  );

  useEffect(() => {
    if (!selectedRobot) return;
    if (selectedRobot.thumbnailUrl) {
      autoThumbnailAttemptedRef.current.delete(selectedRobot.id);
      return;
    }
    if (selectedRobot.status !== 'ONLINE' && selectedRobot.status !== 'BUSY') return;
    if (
      !previewAvailable ||
      thumbnailOp !== null ||
      autoThumbnailAttemptedRef.current.has(selectedRobot.id)
    ) {
      return;
    }

    autoThumbnailAttemptedRef.current.add(selectedRobot.id);
    let attempts = 0;
    const maxAttempts = 8;
    const interval = window.setInterval(() => {
      const video = previewContainerRef.current?.querySelector('video') ?? null;
      const ready = Boolean(video && video.videoWidth > 0 && video.videoHeight > 0);
      attempts += 1;
      if (ready) {
        window.clearInterval(interval);
        void capturePreviewThumbnail({ silent: true });
      } else if (attempts >= maxAttempts) {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [capturePreviewThumbnail, previewAvailable, selectedRobot, thumbnailOp]);

  const removeThumbnail = useCallback(async () => {
    if (!accessToken || !selectedRobot) return;

    setThumbnailOp('remove');
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      await api.robots.deleteRobotThumbnail(selectedRobot.id);
      onRobotUpdated({ ...selectedRobot, thumbnailUrl: null });
      setStatus('Thumbnail removed.');
      pushToast('Thumbnail removed.', 'success', 2400);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove thumbnail';
      setError(message);
      pushToast(message, 'error', 3200);
    } finally {
      setThumbnailOp(null);
    }
  }, [accessToken, onRobotUpdated, selectedRobot, setError, setStatus]);

  return {
    thumbnailInputRef,
    previewContainerRef,
    thumbnailOp,
    handleThumbnailFileChange,
    capturePreviewThumbnail,
    removeThumbnail,
  };
}
