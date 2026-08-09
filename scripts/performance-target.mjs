const loopbackTargets = new Set(['127.0.0.1', 'localhost', '::1']);
const dockerServiceTargets = new Set(['api', 'nginx', 'performance-gateway']);

export function assertPerformanceTargetAllowed(url, allowDocker) {
  if (loopbackTargets.has(url.hostname)) return;
  const privateDockerTarget =
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  if ((dockerServiceTargets.has(url.hostname) || privateDockerTarget) && allowDocker) return;
  throw new Error('Performance load is restricted to the local Docker environment.');
}
