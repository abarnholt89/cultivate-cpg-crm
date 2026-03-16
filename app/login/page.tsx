"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/brands";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold">Login</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to Cultivate CRM
          </p>
        </div>

        {status ? <p className="text-sm text-red-600">{status}</p> : null}

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Password</label>
          <input
            type="password"
            className="w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="w-full bg-black text-white rounded px-4 py-2"
        >
          Sign In
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading login…</div>}>
      <LoginInner />
    </Suspense>
  );
}