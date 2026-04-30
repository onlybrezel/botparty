import type { RobotPublic } from '@botparty/shared';

export type ParsedRobotRoute = {
  username: string | null;
  slug: string;
};

type RobotRouteTarget = Pick<RobotPublic, 'description' | 'name' | 'slug'> & {
  owner: Pick<RobotPublic['owner'], 'username'>;
};

export function buildRobotDescription(robot: Pick<RobotPublic, 'description' | 'name'>): string {
  const fallback = `Watch and control ${robot.name} live on BotParty.`;
  const description = robot.description?.trim() || fallback;
  return description.length <= 160 ? description : `${description.slice(0, 157).trimEnd()}...`;
}

export function parseRobotRouteParts(parts: string[]): ParsedRobotRoute | null {
  if (parts.length === 1) {
    return { username: null, slug: parts[0] ?? '' };
  }

  if (parts.length === 2) {
    return { username: parts[0] ?? null, slug: parts[1] ?? '' };
  }

  return null;
}

export function canonicalRobotPath(robot: RobotRouteTarget): string {
  return `/robot/${robot.owner.username}/${robot.slug}`;
}

export function shouldRedirectToCanonical(
  route: ParsedRobotRoute,
  robot: RobotRouteTarget,
): boolean {
  return route.username !== robot.owner.username || route.slug !== robot.slug;
}

export function buildRobotLookupUrl(apiUrl: string, route: ParsedRobotRoute): string {
  return route.username
    ? `${apiUrl}/api/v1/robots/${encodeURIComponent(route.username)}/${encodeURIComponent(route.slug)}`
    : `${apiUrl}/api/v1/robots/${encodeURIComponent(route.slug)}`;
}
