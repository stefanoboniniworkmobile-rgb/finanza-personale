import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const path = req.nextUrl.pathname;
  const isAuthPage = path.startsWith("/login");
  // Pagine pubbliche: home, login, callback Auth.js, e la pagina di conferma
  // del cambio email (il token nell'URL è la credenziale, non serve essere
  // loggati per usarla — anzi spesso si arriva qui DOPO un logout forzato).
  const isPublic =
    isAuthPage ||
    path.startsWith("/api/auth") ||
    path.startsWith("/account/confirm-email-change") ||
    path === "/";

  if (!isAuth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isAuth && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
