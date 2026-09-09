import { clerkMiddleware } from '@clerk/nextjs/server';

// Clerk still needs request context on matching requests. Authentication belongs at each
// resource instead: the Secretary pages/actions use Clerk, while staff, ingest and cron
// deliberately use their own session/secret checks and must remain reachable without a
// browser Clerk session.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
