import type { RobotPublic } from '@botparty/shared';
import {
  buildRobotDescription,
  buildRobotLookupUrl,
  canonicalRobotPath,
  parseRobotRouteParts,
  shouldRedirectToCanonical,
} from './robot-route';

const robot = {
  name: 'Mars Rover',
  slug: 'mars-rover',
  description: 'A compact telepresence robot for indoor mapping.',
  owner: {
    username: 'julien',
  },
} as Pick<RobotPublic, 'name' | 'slug' | 'description'> & {
  owner: Pick<RobotPublic['owner'], 'username'>;
};

describe('robot-route helpers', () => {
  it('parses legacy and canonical robot paths', () => {
    expect(parseRobotRouteParts(['mars-rover'])).toEqual({ username: null, slug: 'mars-rover' });
    expect(parseRobotRouteParts(['julien', 'mars-rover'])).toEqual({
      username: 'julien',
      slug: 'mars-rover',
    });
    expect(parseRobotRouteParts(['too', 'many', 'parts'])).toBeNull();
  });

  it('builds canonical paths and redirect checks', () => {
    expect(canonicalRobotPath(robot)).toBe('/robot/julien/mars-rover');
    expect(shouldRedirectToCanonical({ username: null, slug: 'mars-rover' }, robot)).toBe(true);
    expect(shouldRedirectToCanonical({ username: 'julien', slug: 'mars-rover' }, robot)).toBe(
      false,
    );
  });

  it('builds lookup urls for legacy and canonical routes', () => {
    expect(
      buildRobotLookupUrl('https://api.example.com', { username: null, slug: 'mars-rover' }),
    ).toBe('https://api.example.com/api/v1/robots/mars-rover');
    expect(
      buildRobotLookupUrl('https://api.example.com', { username: 'julien', slug: 'mars rover' }),
    ).toBe('https://api.example.com/api/v1/robots/julien/mars%20rover');
  });

  it('truncates metadata descriptions safely', () => {
    const description = buildRobotDescription({
      name: 'Mars Rover',
      description: 'x'.repeat(220),
    });

    expect(description).toHaveLength(160);
    expect(description.endsWith('...')).toBe(true);
  });
});
