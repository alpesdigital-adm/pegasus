import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // Skip middleware entirely for API routes — they handle their own auth
  // This avoids an extra Supabase round-trip per API call
  if (request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Only match page routes that need auth protection.
     * Exclude:
     * - /api/* (API routes handle their own auth)
     * - _next/* (static files, chunks, HMR, etc.)
     * - favicon.ico, static assets
     */
    '/((?!api|_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf)$).*)',
  ],
}
