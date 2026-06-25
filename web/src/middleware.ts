import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Start with a passthrough response so cookies can be mutated on it.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write to request so downstream code sees the updated cookies,
          // then rebuild the response so the browser gets the Set-Cookie headers.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh the session — writes updated tokens to cookies if needed.
  // Must call getUser() (not getSession()) to verify the JWT server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Guard: redirect unauthenticated requests to /login
  if (
    !user &&
    (request.nextUrl.pathname.startsWith('/app') ||
      request.nextUrl.pathname.startsWith('/onboarding') ||
      request.nextUrl.pathname.startsWith('/company'))
  ) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  // Guard: redirect authenticated users away from auth pages
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/register')
  ) {
    const appUrl = request.nextUrl.clone()
    appUrl.pathname = '/app'
    return NextResponse.redirect(appUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
