import { createAuthClient } from "better-auth/client";
import { useCallback, useEffect, useState } from "react";

const authClient = createAuthClient();

export type AuthState = {
  isGuest: boolean;
  isLoading: boolean;
  email?: string;
  displayName?: string;
  error?: Error;
  retry: () => void;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<Omit<AuthState, "retry">>({
    isGuest: true,
    isLoading: true
  });
  const [retryRevision, setRetryRevision] = useState(0);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true, error: undefined }));
    setRetryRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void authClient
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setState({
          isGuest: !data?.user,
          isLoading: false,
          email: data?.user.email,
          displayName: data?.user.name
        });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setState({
          isGuest: true,
          isLoading: false,
          error:
            caught instanceof Error
              ? caught
              : new Error("The session request failed.")
        });
      });
    return () => {
      active = false;
    };
  }, [retry, retryRevision]);

  return { ...state, retry };
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
