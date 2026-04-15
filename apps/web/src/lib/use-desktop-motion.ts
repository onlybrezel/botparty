'use client';

import { useEffect, useState } from 'react';

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

export function useDesktopMotionPreference() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    const narrowViewportQuery = window.matchMedia('(max-width: 960px)');

    const update = () => {
      const navigatorInfo = window.navigator as NavigatorWithDeviceMemory;
      const cpuCores = navigatorInfo.hardwareConcurrency ?? 4;
      const deviceMemory = navigatorInfo.deviceMemory ?? 0;
      const strongEnoughDevice = cpuCores >= 6 && (deviceMemory === 0 || deviceMemory >= 4);

      setEnabled(
        strongEnoughDevice &&
          !reducedMotionQuery.matches &&
          !coarsePointerQuery.matches &&
          !narrowViewportQuery.matches,
      );
    };

    update();
    reducedMotionQuery.addEventListener('change', update);
    coarsePointerQuery.addEventListener('change', update);
    narrowViewportQuery.addEventListener('change', update);

    return () => {
      reducedMotionQuery.removeEventListener('change', update);
      coarsePointerQuery.removeEventListener('change', update);
      narrowViewportQuery.removeEventListener('change', update);
    };
  }, []);

  return enabled;
}
