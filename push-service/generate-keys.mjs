import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
// Never print the private key or shared secret, and never overwrite existing keys.
await writeFile(new URL('.env', import.meta.url), `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:administrator@example.com\nPUSH_RELAY_SECRET=${randomBytes(32).toString('hex')}\nPORT=3002\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write('Created push-service/.env. Set VAPID_SUBJECT to your real administrator email and keep this file private.\n');
