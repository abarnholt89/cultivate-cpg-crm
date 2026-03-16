"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/brands";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");



async function signIn() {
  setStatus("Signing in…");

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    setStatus(error.message);
    return;
  }

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;

  if (!userId) {
    router.replace("/login");
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  setStatus("Signed in ✅");

  // honor protected-route redirects first
  if (next && next !== "/brands") {
    router.replace(next);
    return;
  }

  if (profile?.role === "rep" || profile?.role === "admin") {
    router.replace("/inbox");
    return;
  }

  // client routing: if they only can see one brand, skip the list
  if (profile?.role === "client") {
    const { data: visibleBrands, error: brandsError } = await supabase
      .from("brands")
      .select("id")
      .limit(2);

    if (!brandsError && visibleBrands?.length === 1) {
      router.replace(`/brands/${visibleBrands[0].id}`);
      return;
    }

    router.replace("/brands");
    return;
  }

  router.replace("/brands");
}

async function signOut() {
  setStatus("Signing out…");

  const { error } = await supabase.auth.signOut();

  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus("Signed out.");
  router.replace("/login");
  router.refresh();
}

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Cultivate CRM Login</h1>
          <p className="text-sm text-gray-600 mt-1">
            Sign in with your email + password.
          </p>
        </div>

        {status && <div className="text-sm text-red-600">{status}</div>}

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Password</label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            autoComplete="current-password"
          />
        </div>

        <button
          onClick={signIn}
          className="bg-black text-white px-4 py-2 rounded w-full"
        >
          Sign In
        </button>

        <div className="flex items-center justify-between text-sm">
          <Link className="underline" href={next}>
            Continue without redirecting
          </Link>
          <button className="underline" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}