import { expect, test as base, type Page } from '@playwright/test';

export type BrowserIssueControls = {
  allowConsoleError: (messagePattern: RegExp) => void;
  allowHttpError: (status: number, urlPattern: RegExp) => void;
  allowRequestFailure: (urlPattern: RegExp, failurePattern?: RegExp) => void;
};

export type BrowserIssueMonitor = BrowserIssueControls & {
  assertNoUnexpectedIssues: () => void;
};

export function monitorBrowserIssues(page: Page): BrowserIssueMonitor {
  const issues: string[] = [];
  const allowedHttpErrors: Array<{ status: number; urlPattern: RegExp }> = [
    { status: 401, urlPattern: /\/api\/v1\/auth\/refresh$/ },
  ];
  const allowedResourceErrorCounts = new Map<number, number>();
  const resourceConsoleErrors: Array<{ status: number; message: string }> = [];
  const allowedConsoleErrors: RegExp[] = [];
  const environmentConsoleWarnings = [
    // Firefox reports the intentional legacy fallback when strict-dynamic is present.
    /Content-Security-Policy: Ignoring .*'self'.*strict-dynamic.*specified/i,
    // The isolated Docker proxy uses HTTP; production requires HTTPS for auth cookies.
    /Password fields present on an insecure \(http:\/\/\) page/i,
  ];
  const allowedRequestFailures: Array<{ urlPattern: RegExp; failurePattern?: RegExp }> = [];

  page.on('console', (message) => {
    const messageType = message.type();
    if (messageType !== 'error' && messageType !== 'warning') {
      return;
    }

    const messageText = message.text();
    if (
      messageType === 'error' &&
      allowedConsoleErrors.some((pattern) => pattern.test(messageText))
    ) {
      return;
    }
    if (
      messageType === 'warning' &&
      environmentConsoleWarnings.some((pattern) => pattern.test(messageText))
    ) {
      return;
    }
    const resourceStatus =
      messageType === 'error' &&
      messageText.match(/^Failed to load resource: the server responded with a status of (\d{3})/);
    if (resourceStatus) {
      resourceConsoleErrors.push({ status: Number(resourceStatus[1]), message: messageText });
      return;
    }

    issues.push(`console.${messageType}: ${messageText}`);
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown transport error';
    const allowed = allowedRequestFailures.some(
      ({ urlPattern, failurePattern }) =>
        urlPattern.test(request.url()) && (!failurePattern || failurePattern.test(failure)),
    );
    // Engines use different names when an in-flight document or RSC request
    // is intentionally cancelled by the next browser navigation.
    const browserNavigationCancellation =
      /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_FAILURE|Load request cancelled)$/i.test(
        failure,
      );
    if (!browserNavigationCancellation && !allowed) {
      issues.push(`requestfailed: ${request.method()} ${request.url()} (${failure})`);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }
    const allowed = allowedHttpErrors.some(
      ({ status, urlPattern }) => status === response.status() && urlPattern.test(response.url()),
    );
    if (allowed) {
      allowedResourceErrorCounts.set(
        response.status(),
        (allowedResourceErrorCounts.get(response.status()) ?? 0) + 1,
      );
      return;
    }
    issues.push(`http ${response.status()}: ${response.request().method()} ${response.url()}`);
  });

  return {
    allowConsoleError(messagePattern) {
      allowedConsoleErrors.push(messagePattern);
    },
    allowHttpError(status, urlPattern) {
      allowedHttpErrors.push({ status, urlPattern });
    },
    allowRequestFailure(urlPattern, failurePattern) {
      allowedRequestFailures.push({
        urlPattern,
        ...(failurePattern ? { failurePattern } : {}),
      });
    },
    assertNoUnexpectedIssues() {
      const resourceErrorsByStatus = new Map<number, Array<{ status: number; message: string }>>();
      for (const resourceError of resourceConsoleErrors) {
        const matchingErrors = resourceErrorsByStatus.get(resourceError.status) ?? [];
        matchingErrors.push(resourceError);
        resourceErrorsByStatus.set(resourceError.status, matchingErrors);
      }
      for (const [status, resourceErrors] of resourceErrorsByStatus) {
        const allowedCount = allowedResourceErrorCounts.get(status) ?? 0;
        for (const resourceError of resourceErrors.slice(allowedCount)) {
          issues.push(`console.error: ${resourceError.message}`);
        }
      }

      expect.soft(issues, 'unexpected browser console or network issues').toEqual([]);
    },
  };
}

export const test = base.extend<{ browserIssues: BrowserIssueControls }>({
  browserIssues: [
    async ({ page }, use) => {
      const monitor = monitorBrowserIssues(page);
      await use(monitor);
      monitor.assertNoUnexpectedIssues();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
