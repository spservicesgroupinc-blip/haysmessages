import { createPushFetch } from '../push-service/vercel-handler.mjs';

// Vercel Node.js function. The browser bundle never imports this entrypoint or sender secrets.
export default { fetch: createPushFetch() };
