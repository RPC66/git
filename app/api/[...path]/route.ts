import { env } from 'cloudflare:workers';
import { createJournalService } from '../../../lib/journal-service.mjs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return createJournalService({db:env.DB,env}).handle(request);
}
export const GET = handle;
export const POST = handle;
