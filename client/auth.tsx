import { createAuthClient } from "better-auth/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";

const authClient = createAuthClient();

export type AuthState = {
  isGuest: boolean;
  isLoading: boolean;
  email?: string;
  displayName?: string;
  error?: Error;
  retry: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

function useAuthState(): AuthState {
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
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setState({
            isGuest: true,
            isLoading: false,
            error: new Error(error.message || "The session request failed.")
          });
          return;
        }
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider.");
  return auth;
}

export function SignInWithGoogle({ className }: { className?: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.href
      });
      if (result.error) {
        setError(result.error.message || "Google sign-in could not start.");
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Google sign-in could not start."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={className}
        disabled={busy}
        onClick={() => void signIn()}
        type="button"
      >
        {busy ? "Starting sign-in…" : "Sign in with Google"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </>
  );
}

export function signOut(): void {
  void authClient.signOut().finally(() => window.location.assign("/"));
}
