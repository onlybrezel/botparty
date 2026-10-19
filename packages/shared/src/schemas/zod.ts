import { config } from 'zod';

// This import must run before constructing schemas, including the auth subpath.
if ('window' in globalThis) {
  config({ jitless: true });
}
