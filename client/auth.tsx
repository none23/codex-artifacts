import { createAuthClient } from "better-auth/client";
import { useEffect, useState } from "react";

const authClient = createAuthClient();

export type AuthState = {
  isGuest: boolean;
  isLoading: boolean;
  email?: string;
  displayName?: string;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    isGuest: true,
    isLoading: true
  });

  useEffect(() => {
    let active = true;
    void authClient.getSession().then(({ data }) => {
      if (!active) return;
      setState({
        isGuest: !data?.user,
        isLoading: false,
        email: data?.user.email,
        displayName: data?.user.name
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

export function SignInWithGoogle({ className }: { className?: string }) {
  return (
    <button
      className={className}
      onClick={() =>
        void authClient.signIn.social({
          provider: "google",
          callbackURL: window.location.href
        })
      }
      type="button"
    >
      Sign in with Google
    </button>
  );
}

export function signOut(): void {
  void authClient.signOut().finally(() => window.location.assign("/"));
}
