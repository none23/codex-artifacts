import {
  BrowserRouter as Router,
  Link,
  Route,
  Routes,
  useLocation,
  useParams
} from "react-router-dom";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { OwnedArtifact, ViewedArtifact } from "../shared/api";
import { client } from "./api";
import { SignInWithGoogle, signOut, useAuth } from "./auth";
import {
  DEFAULT_EXPIRATION_SECONDS,
  MAX_ARTIFACT_BYTES,
  MAX_TOTAL_ARTIFACT_BYTES,
  artifactHref,
  cleanSlug,
  isValidDomain,
  isValidEmail,
  normalizeDomain,
  normalizeEmail
} from "../shared/config";

const DEFAULT_DOCUMENT_TITLE = "Codex Artifacts";
const KNOWN_EMAILS_KEY = "codex-artifacts:known-emails";
const SRCDOC_BASE = '<base href="about:srcdoc">';
const EXPIRATION_OPTIONS = [
  { label: "1 hour", value: "3600" },
  { label: "1 day", value: "86400" },
  { label: "3 days (default)", value: String(DEFAULT_EXPIRATION_SECONDS) },
  { label: "1 week", value: "604800" },
  { label: "30 days", value: "2592000" },
  { label: "Never", value: "never" }
] as const;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function expirationValue(value: FormDataEntryValue | string | null): number | null {
  return value === "never" ? null : Number(value || DEFAULT_EXPIRATION_SECONDS);
}

function expirationLabel(expiresAt: string | null): string {
  return expiresAt ? `expires ${formatDate(expiresAt)}` : "never expires";
}

function slugFromTitle(title: string): string {
  const base = cleanSlug(title) || "artifact";
  return `${base}-${Date.now().toString(36)}`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function withSrcdocBase(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const insertionPoint = head.index + head[0].length;
    return `${html.slice(0, insertionPoint)}${SRCDOC_BASE}${html.slice(insertionPoint)}`;
  }

  const documentElement = /<html(?:\s[^>]*)?>/i.exec(html);
  if (documentElement) {
    const insertionPoint = documentElement.index + documentElement[0].length;
    return `${html.slice(0, insertionPoint)}<head>${SRCDOC_BASE}</head>${html.slice(insertionPoint)}`;
  }

  const doctype = /<!doctype(?:\s[^>]*)?>/i.exec(html);
  if (doctype) {
    const insertionPoint = doctype.index + doctype[0].length;
    return `${html.slice(0, insertionPoint)}<head>${SRCDOC_BASE}</head>${html.slice(insertionPoint)}`;
  }

  return `<head>${SRCDOC_BASE}</head>${html}`;
}

function readKnownEmails(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KNOWN_EMAILS_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((email): email is string => typeof email === "string" && isValidEmail(email))
      : [];
  } catch {
    return [];
  }
}

function rememberEmails(values: string[]): string[] {
  const emails = [...new Set([...readKnownEmails(), ...values.map(normalizeEmail)])]
    .filter(isValidEmail)
    .sort();
  window.localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(emails));
  return emails;
}

function accessLabel(access: {
  isPublic: boolean;
  sharedWith: string[];
  sharedDomains: string[];
  workspaceViewerCount?: number;
}): string {
  if (access.isPublic) return "Public";
  const rules = access.sharedWith.length + access.sharedDomains.length;
  const workspaceViewerCount = access.workspaceViewerCount ?? 0;
  if (workspaceViewerCount && rules) {
    return `Workspace + ${rules} rule${rules === 1 ? "" : "s"}`;
  }
  if (workspaceViewerCount) return "Workspace viewers";
  if (!rules) return "Owners only";
  return `${rules} access rule${rules === 1 ? "" : "s"}`;
}

function SignInCard({ shared = false }: { shared?: boolean }) {
  return (
    <section className={`mx-auto flex max-w-xl items-center px-6 py-16 ${shared ? "min-h-screen" : "min-h-[70vh]"}`}>
      <div className="w-full rounded-2xl border border-[#242424] bg-[#121212] p-8 shadow-2xl shadow-black/30">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-[#de5e1e]">Private workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          {shared ? "Sign in to open this artifact" : "Your Codex artifacts, in one quiet place."}
        </h1>
        <p className="mt-4 leading-7 text-[#a3a3a3]">
          Access is checked against a verified Google email. Shared links do not make their contents public.
        </p>
        <SignInWithGoogle className="mt-8 inline-flex items-center rounded-lg bg-[#de5e1e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#ed7134]" />
      </div>
    </section>
  );
}

function AppHeader() {
  const auth = useAuth();
  return (
    <header className="border-b border-[#242424] bg-[#0b0b0b]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link className="flex items-center gap-3" to="/">
          <img alt="" className="h-9 w-9" src="/favicon.svg" />
          <span>
            <span className="block text-sm font-semibold text-white">Codex Artifacts</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[#737373]">private by default</span>
          </span>
        </Link>
        {!auth.isGuest && !auth.isLoading ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden max-w-64 truncate text-sm text-[#a3a3a3] sm:block">{auth.email ?? auth.displayName}</span>
            <button className="rounded-lg border border-[#303030] px-3 py-2 text-sm text-white transition hover:border-[#555]" onClick={() => signOut()} type="button">Sign out</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function NewArtifactForm() {
  const publishArtifact = client.useMutation("publishArtifact");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const file = data.get("file");
    const requestedTitle = String(data.get("title") ?? "").trim();
    if (!(file instanceof File) || !file.size) {
      setError("Choose an HTML file first.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const html = await file.text();
      const title = requestedTitle || file.name.replace(/\.html?$/i, "");
      const slug = slugFromTitle(title);
      const result = await publishArtifact({
        title,
        slug,
        html,
        expiresInSeconds: expirationValue(data.get("expiresInSeconds"))
      });
      const url = `${window.location.origin}${artifactHref(result.slug)}`;
      setNotice(url);
      form.reset();
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#242424] bg-[#121212]">
      <div className="grid gap-8 p-6 md:grid-cols-[1fr_auto] md:items-end md:p-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#de5e1e]">New artifact</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Publish an HTML file</h2>
          <p className="mt-2 text-sm leading-6 text-[#a3a3a3]">Artifacts expire after three days by default, freeing their storage automatically. Owners and workspace viewers can open every artifact; additional recipients can be added per artifact.</p>
          <p className="mt-2 text-xs text-[#737373]">Maximum {formatBytes(MAX_ARTIFACT_BYTES)} per artifact; {formatBytes(MAX_TOTAL_ARTIFACT_BYTES)} workspace HTML budget.</p>
        </div>
        <form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          <label className="grid gap-1.5 text-xs font-medium text-[#a3a3a3]">
            Title (optional)
            <input className="h-11 rounded-lg border border-[#303030] bg-[#0b0b0b] px-3 text-sm text-white outline-none transition placeholder:text-[#555] focus:border-[#de5e1e]" name="title" placeholder="Architecture review" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#a3a3a3]">
            HTML file
            <input accept=".html,.htm,text/html" className="h-11 max-w-full rounded-lg border border-[#303030] bg-[#0b0b0b] px-3 py-2 text-xs text-[#d4d4d4] file:mr-3 file:border-0 file:bg-transparent file:text-[#de5e1e]" name="file" required type="file" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#a3a3a3]">
            Expires in
            <select className="h-11 rounded-lg border border-[#303030] bg-[#0b0b0b] px-3 text-sm text-white outline-none focus:border-[#de5e1e]" defaultValue={String(DEFAULT_EXPIRATION_SECONDS)} name="expiresInSeconds">
              {EXPIRATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="h-11 self-end rounded-lg bg-[#de5e1e] px-5 text-sm font-bold text-white transition hover:bg-[#ed7134] disabled:cursor-wait disabled:opacity-60" disabled={busy} type="submit">{busy ? "Publishing…" : "Publish"}</button>
        </form>
      </div>
      {error ? <p className="border-t border-red-400/20 bg-red-400/10 px-6 py-3 text-sm text-red-200 md:px-8">{error}</p> : null}
      {notice ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-400/20 bg-emerald-400/10 px-6 py-3 text-sm text-emerald-100 md:px-8">
          <span className="min-w-0 truncate">Published: {notice}</span>
          <button className="font-semibold underline decoration-emerald-300/40 underline-offset-4" onClick={() => void navigator.clipboard.writeText(notice)} type="button">Copy link</button>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactCard({ artifact }: { artifact: OwnedArtifact }) {
  const publishArtifact = client.useMutation("publishArtifact");
  const deleteArtifact = client.useMutation("deleteArtifact");
  const setArtifactExpiration = client.useMutation("setArtifactExpiration");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresIn, setExpiresIn] = useState(String(DEFAULT_EXPIRATION_SECONDS));
  const url = `${window.location.origin}${artifactHref(artifact.slug)}`;

  async function replace(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus("");
    try {
      await publishArtifact({
        artifactId: artifact.id,
        title: artifact.title,
        slug: artifact.slug,
        html: await file.text(),
        sharedWith: artifact.sharedWith,
        expiresInSeconds: expirationValue(expiresIn)
      });
      setStatus("HTML replaced and expiration reset.");
    } catch (caught) {
      setStatus(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function applyExpiration() {
    setBusy(true);
    setStatus("");
    try {
      await setArtifactExpiration(artifact.id, expirationValue(expiresIn));
      setStatus("Expiration updated.");
    } catch (caught) {
      setStatus(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${artifact.title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteArtifact(artifact.id);
    } catch (caught) {
      setStatus(messageFromError(caught));
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-[#242424] bg-[#121212] p-5 transition hover:border-[#3a3a3a]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link className="block truncate text-lg font-semibold text-white hover:text-[#ed7134]" to={artifactHref(artifact.slug)}>{artifact.title}</Link>
          <p className="mt-1 font-mono text-xs text-[#737373]">{formatBytes(Number(artifact.sizeBytes))} · updated {formatDate(artifact.updatedAt)}</p>
          <p className="mt-1 font-mono text-xs text-[#b8b8b8]">{expirationLabel(artifact.expiresAt)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${artifact.isPublic ? "bg-emerald-300/10 text-emerald-200" : artifact.workspaceViewerCount || artifact.sharedWith.length || artifact.sharedDomains.length ? "bg-[#de5e1e]/15 text-[#f38a55]" : "bg-white/5 text-[#a3a3a3]"}`}>
          {accessLabel(artifact)}
        </span>
      </div>

      <div className="mt-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="rounded-lg bg-[#de5e1e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#ed7134]" to={artifactHref(artifact.slug)}>Open & manage access</Link>
          <button className="rounded-lg border border-[#303030] px-3 py-2 text-xs font-medium text-white hover:border-[#555]" onClick={() => void navigator.clipboard.writeText(url)} type="button">Copy link</button>
          <label className="cursor-pointer rounded-lg border border-[#303030] px-3 py-2 text-xs font-medium text-white hover:border-[#555]">
            Replace HTML
            <input accept=".html,.htm,text/html" className="hidden" disabled={busy} onChange={(event) => void replace(event.currentTarget.files?.[0])} type="file" />
          </label>
          <button className="rounded-lg px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-400/10 disabled:opacity-50 sm:ml-auto" disabled={busy} onClick={() => void remove()} type="button">Delete</button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-[#242424] pt-3">
          <label className="grid gap-1 text-[11px] font-medium text-[#737373]">
            New lifetime (also used by Replace HTML)
            <select className="h-9 rounded-lg border border-[#303030] bg-[#0b0b0b] px-3 text-xs text-[#d4d4d4] outline-none focus:border-[#de5e1e]" disabled={busy} onChange={(event) => setExpiresIn(event.currentTarget.value)} value={expiresIn}>
              {EXPIRATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="h-9 rounded-lg border border-[#303030] px-3 text-xs font-medium text-white hover:border-[#555] disabled:opacity-50" disabled={busy} onClick={() => void applyExpiration()} type="button">Apply now</button>
        </div>
        {status ? <p className="text-xs text-[#a3a3a3]">{status}</p> : null}
      </div>
    </article>
  );
}

function OwnerDashboard() {
  const artifacts = client.useQuery("ownedArtifacts");
  const pruneExpiredArtifacts = client.useMutation("pruneExpiredArtifacts");
  useEffect(() => {
    void pruneExpiredArtifacts();
  }, []);
  const usedBytes = artifacts?.reduce(
    (total, artifact) => total + Number(artifact.sizeBytes),
    0
  ) ?? 0;
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <NewArtifactForm />
      <section className="mt-10">
        <div className="mb-5 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#de5e1e]">Library</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Published artifacts</h1>
          </div>
          <span className="text-sm text-[#737373]">
            {artifacts?.length ?? 0} total · {formatBytes(usedBytes)} of {formatBytes(MAX_TOTAL_ARTIFACT_BYTES)}
          </span>
        </div>
        {!artifacts ? (
          <div className="rounded-xl border border-[#242424] p-8 text-center text-[#737373]">Loading artifacts…</div>
        ) : artifacts.length ? (
          <div className="grid gap-4 lg:grid-cols-2">{artifacts.map((artifact) => <ArtifactCard artifact={artifact} key={artifact.id} />)}</div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#303030] p-12 text-center">
            <p className="text-[#d4d4d4]">No artifacts yet.</p>
            <p className="mt-1 text-sm text-[#737373]">Publish an HTML file above or use the automation script.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function NonOwnerHome({ isWorkspaceViewer }: { isWorkspaceViewer: boolean }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#de5e1e]">Signed in</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
        {isWorkspaceViewer ? "Workspace viewer access is active." : "Open the link that was shared with you."}
      </h1>
      <p className="mt-5 leading-7 text-[#a3a3a3]">
        {isWorkspaceViewer
          ? "You can open every artifact link in this workspace, without management access."
          : "Additional access is granted per artifact and verified Google email."}
      </p>
    </main>
  );
}

function useAccessBootstrap() {
  const viewer = client.useQuery("viewer");
  const claimOwnerAccess = client.useMutation("claimOwnerAccess");
  const claimWorkspaceViewerAccess = client.useMutation("claimWorkspaceViewerAccess");
  const [state, setState] = useState<"idle" | "claiming" | "claimed" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (
      !viewer ||
      viewer.isOwner ||
      viewer.isWorkspaceViewer ||
      (!viewer.canClaimOwner && !viewer.canClaimWorkspaceViewer) ||
      state !== "idle"
    ) {
      return;
    }

    setState("claiming");
    const claim = viewer.canClaimOwner
      ? claimOwnerAccess
      : claimWorkspaceViewerAccess;
    void claim()
      .then((result) => {
        if (!result.claimed) {
          setError("This Google identity could not accept its configured workspace invitation.");
          setState("error");
          return;
        }
        setState("claimed");
      })
      .catch((caught) => {
        setError(messageFromError(caught));
        setState("error");
      });
  }, [
    viewer?.isOwner,
    viewer?.isWorkspaceViewer,
    viewer?.canClaimOwner,
    viewer?.canClaimWorkspaceViewer,
    state
  ]);

  return { viewer, state, error };
}

function AccessControl({ artifact }: { artifact: ViewedArtifact }) {
  const setArtifactAccess = client.useMutation("setArtifactAccess");
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>(artifact.sharedWith);
  const [domains, setDomains] = useState<string[]>(artifact.sharedDomains);
  const [isPublic, setIsPublic] = useState(artifact.isPublic);
  const [emailInput, setEmailInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [knownEmails, setKnownEmails] = useState<string[]>(readKnownEmails);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function addEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeEmail(emailInput);
    if (!isValidEmail(email)) {
      setStatus("Enter a valid email address.");
      return;
    }
    if (artifact.ownerEmails.includes(email)) {
      setStatus("That address already has owner access.");
      return;
    }
    if (artifact.workspaceViewerEmails.includes(email)) {
      setStatus("That address already has workspace viewer access.");
      return;
    }
    setEmails((current) => current.includes(email) ? current : [...current, email]);
    setKnownEmails(rememberEmails([email]));
    setEmailInput("");
    setStatus("");
  }

  function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = normalizeDomain(domainInput);
    if (!isValidDomain(domain)) {
      setStatus("Enter a valid domain, such as example.com.");
      return;
    }
    setDomains((current) => current.includes(domain) ? current : [...current, domain]);
    setDomainInput("");
    setStatus("");
  }

  async function save() {
    setBusy(true);
    setStatus("");
    try {
      const saved = await setArtifactAccess(artifact.id, { emails, domains, isPublic });
      setEmails(saved.emails);
      setDomains(saved.domains);
      setIsPublic(saved.isPublic);
      setKnownEmails(rememberEmails(saved.emails));
      setStatus("Access updated.");
    } catch (caught) {
      setStatus(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

  const accessDescription = `Access · ${accessLabel({
    isPublic,
    sharedWith: emails,
    sharedDomains: domains,
    workspaceViewerCount: artifact.workspaceViewerEmails.length
  })}`;

  return (
    <div className="relative">
      <button
        aria-label={accessDescription}
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs leading-4 text-white hover:border-white/30 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5"
        onClick={() => setOpen((value) => !value)}
        title={accessDescription}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
          <rect height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="10.5" x="4.75" y="8.25" />
          <path d="M7 8.25V6a3 3 0 0 1 6 0v2.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </svg>
        <span className="hidden sm:inline">{accessDescription}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-slate-950 p-5 text-left shadow-2xl shadow-black/50" role="dialog" aria-label="Artifact access settings">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-white">Access settings</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Changes apply to additional access for this artifact. Owners and workspace viewers always retain access.</p>
            </div>
            <button aria-label="Close access settings" className="text-lg leading-none text-slate-500 hover:text-white" onClick={() => setOpen(false)} type="button">×</button>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3">
            <input checked={isPublic} className="mt-0.5 h-4 w-4 accent-[#de5e1e]" onChange={(event) => setIsPublic(event.currentTarget.checked)} type="checkbox" />
            <span>
              <span className="block text-sm font-medium text-white">Public link</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Anyone with the link can view without signing in.</span>
            </span>
          </label>

          {artifact.workspaceViewerEmails.length ? (
            <div className="mt-5">
              <p className="text-xs font-medium text-slate-400">Workspace viewers</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                These deployment-level viewers can open every artifact and cannot be removed here.
              </p>
              <ul className="mt-2 grid gap-1">
                {artifact.workspaceViewerEmails.map((email) => (
                  <li className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300" key={email}>
                    <span className="truncate">{email}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5">
            <label className="text-xs font-medium text-slate-400" htmlFor="artifact-access-email">Additional people</label>
            <form className="mt-1.5 flex gap-2" onSubmit={(event) => addEmail(event)}>
              <input
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-[#de5e1e]/60"
                id="artifact-access-email"
                list="artifact-known-emails"
                onInput={(event) => setEmailInput(event.currentTarget.value)}
                placeholder="person@example.com"
                type="email"
                value={emailInput}
              />
              <datalist id="artifact-known-emails">
                {knownEmails.filter((email) => !emails.includes(email)).map((email) => <option key={email} value={email} />)}
              </datalist>
              <button className="rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:border-white/30" type="submit">Add</button>
            </form>
            {emails.length ? (
              <ul className="mt-2 grid gap-1">
                {emails.map((email) => (
                  <li className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300" key={email}>
                    <span className="truncate">{email}</span>
                    <button aria-label={`Remove ${email}`} className="text-slate-500 hover:text-red-300" onClick={() => setEmails((current) => current.filter((value) => value !== email))} type="button">Remove</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mt-5">
            <label className="text-xs font-medium text-slate-400" htmlFor="artifact-access-domain">Domains</label>
            <form className="mt-1.5 flex gap-2" onSubmit={(event) => addDomain(event)}>
              <input
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-[#de5e1e]/60"
                id="artifact-access-domain"
                onInput={(event) => setDomainInput(event.currentTarget.value)}
                placeholder="example.com"
                value={domainInput}
              />
              <button className="rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:border-white/30" type="submit">Add</button>
            </form>
            {domains.length ? (
              <ul className="mt-2 grid gap-1">
                {domains.map((domain) => (
                  <li className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300" key={domain}>
                    <span className="truncate">@{domain}</span>
                    <button aria-label={`Remove ${domain}`} className="text-slate-500 hover:text-red-300" onClick={() => setDomains((current) => current.filter((value) => value !== domain))} type="button">Remove</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <p className="text-xs text-slate-500">{status}</p>
            <button className="rounded-lg bg-[#de5e1e] px-4 py-2 text-xs font-bold text-[#0b0b0b] hover:bg-[#ed7134] disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save access"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactFrame({ slug }: { slug: string }) {
  const auth = useAuth();
  const artifact = client.useQuery("artifactBySlug", slug);
  const acceptArtifactAccess = client.useMutation("acceptArtifactAccess");
  const accessBootstrap = useAccessBootstrap();
  const [accessState, setAccessState] = useState<"idle" | "accepting" | "accepted" | "expired" | "denied">("idle");
  const [expiredAt, setExpiredAt] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = artifact
      ? `${artifact.title} · ${DEFAULT_DOCUMENT_TITLE}`
      : DEFAULT_DOCUMENT_TITLE;

    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [artifact?.title]);

  const downloadUrl = useMemo(() => {
    if (!artifact) return "";
    return URL.createObjectURL(new Blob([artifact.html], { type: "text/html;charset=utf-8" }));
  }, [artifact?.html]);
  const previewHtml = useMemo(
    () => artifact ? withSrcdocBase(artifact.html) : "",
    [artifact?.html]
  );

  useEffect(() => {
    if (
      artifact !== null ||
      auth.isLoading ||
      auth.isGuest ||
      accessState !== "idle" ||
      accessBootstrap.state === "claiming"
    ) {
      return;
    }

    setAccessState("accepting");
    void acceptArtifactAccess(slug)
      .then((result) => {
        if (result.status === "expired") {
          setExpiredAt(result.expiredAt);
          setAccessState("expired");
          return;
        }
        setAccessState(result.status === "accepted" ? "accepted" : "denied");
      })
      .catch(() => setAccessState("denied"));
  }, [
    artifact,
    auth.isLoading,
    auth.isGuest,
    slug,
    accessState,
    accessBootstrap.state
  ]);

  useEffect(() => {
    if (artifact !== null || accessState !== "accepted") {
      return;
    }
    const timeout = window.setTimeout(() => setAccessState("denied"), 5000);
    return () => window.clearTimeout(timeout);
  }, [artifact, accessState]);

  if (artifact === undefined) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Opening artifact…</main>;
  }
  if (artifact === null) {
    if (auth.isLoading) {
      return <main className="grid min-h-screen place-items-center text-slate-500">Opening artifact…</main>;
    }
    if (auth.isGuest) {
      return <SignInCard shared />;
    }
    if (accessState === "expired") {
      return (
        <main className="mx-auto grid min-h-screen max-w-xl place-content-center px-6 py-24 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300">Expired</p>
          <h1 className="mt-4 text-3xl font-semibold text-white">This artifact has expired.</h1>
          <p className="mt-4 text-slate-400">
            It expired {formatDate(expiredAt)}. Ask the owner to republish it with a longer lifetime.
          </p>
          <div className="mt-7">
            <Link className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:border-white/30" to="/">Back</Link>
          </div>
        </main>
      );
    }
    if (accessState !== "denied") {
      return <main className="grid min-h-screen place-items-center text-slate-500">Verifying shared access…</main>;
    }
    return (
      <main className="mx-auto grid min-h-screen max-w-xl place-content-center px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-red-300">Not available</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">This artifact does not exist, or it was not shared with your email.</h1>
        <p className="mt-4 text-slate-500">Ask the owner to add the exact Google email you used to sign in.</p>
        <div className="mt-7 flex justify-center gap-3">
          <Link className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:border-white/30" to="/">Back</Link>
          <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-100" onClick={() => signOut()} type="button">Use another account</button>
        </div>
      </main>
    );
  }

  async function copySource() {
    await navigator.clipboard.writeText(artifact!.html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#242424] bg-[#0b0b0b] px-2 py-1.5 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Link aria-label="Back to artifacts" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-white transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#de5e1e]" to="/">
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
              <path d="m12.5 15-5-5 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
            </svg>
          </Link>
          <div className="relative flex min-w-0 items-center gap-1">
            <h1 className="min-w-0 truncate text-sm font-semibold leading-5 text-white">{artifact.title}</h1>
            <details className="static shrink-0">
              <summary
                aria-label="Artifact information"
                className="grid h-6 w-6 cursor-pointer list-none place-items-center rounded-md text-white hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#de5e1e] [&::-webkit-details-marker]:hidden"
                title="Artifact information"
              >
                <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 9v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
                  <circle cx="10" cy="6.5" fill="currentColor" r=".8" />
                </svg>
              </summary>
              <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-max rounded-md border border-white/15 bg-[#161616] px-3 py-2 font-mono text-[11px] leading-5 text-slate-300 shadow-xl shadow-black/50">
                <p className="whitespace-nowrap">{formatBytes(artifact.sizeBytes)}</p>
                <p className="whitespace-nowrap">{expirationLabel(artifact.expiresAt)}</p>
              </div>
            </details>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {artifact.canManage ? <AccessControl artifact={artifact} /> : null}
          <button
            aria-label={copied ? "Source copied" : "Copy source"}
            className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs leading-4 text-white hover:border-white/30 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5"
            onClick={() => void copySource()}
            title={copied ? "Source copied" : "Copy source"}
            type="button"
          >
            {copied ? (
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
                <path d="m4.75 10.25 3.25 3.25 7.25-7.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
            ) : (
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
                <rect height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="8" x="7" y="7" />
                <path d="M12.5 7V5.5A1.5 1.5 0 0 0 11 4H5.5A1.5 1.5 0 0 0 4 5.5V12A1.5 1.5 0 0 0 5.5 13.5H7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
              </svg>
            )}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy source"}</span>
          </button>
          <a
            aria-label="Download HTML"
            className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-md bg-[#de5e1e] text-xs font-bold leading-4 text-white hover:bg-[#ed7134] sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5"
            download={`${artifact.slug}.html`}
            href={downloadUrl}
            title="Download HTML"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
              <path d="M10 3.75v8.5m0 0 3.25-3.25M10 12.25 6.75 9M4.5 14v1.25c0 .55.45 1 1 1h9c.55 0 1-.45 1-1V14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            </svg>
            <span className="hidden sm:inline">Download HTML</span>
          </a>
          {!auth.isGuest ? (
            <button
              aria-label="Sign out"
              className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs leading-4 text-white hover:border-white/30 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5"
              onClick={() => signOut()}
              title="Sign out"
              type="button"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
                <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8m3-3 3-3m0 0-3-3m3 3H7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
              <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : null}
        </div>
      </header>
      <iframe
        className="min-h-[700px] flex-1 border-0 bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
        srcDoc={previewHtml}
        title={artifact.title}
      />
    </main>
  );
}

function RootPage() {
  const auth = useAuth();
  if (auth.isLoading) return <main className="grid min-h-[70vh] place-items-center text-slate-500">Checking session…</main>;
  if (auth.isGuest) return <SignInCard />;
  return <SignedInRoot />;
}

function SignedInRoot() {
  const { viewer, state, error } = useAccessBootstrap();
  if (!viewer) {
    return <main className="grid min-h-[70vh] place-items-center text-slate-500">Loading workspace…</main>;
  }
  if (viewer.isOwner) {
    return <OwnerDashboard />;
  }
  if (viewer.isWorkspaceViewer) {
    return <NonOwnerHome isWorkspaceViewer />;
  }
  if (state === "claiming" || state === "claimed") {
    return <main className="grid min-h-[70vh] place-items-center text-slate-500">Activating workspace access…</main>;
  }
  if (state === "error") {
    return (
      <main className="mx-auto grid min-h-[70vh] max-w-xl place-content-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-white">Workspace access could not be activated.</h1>
        <p className="mt-3 text-slate-400">{error}</p>
      </main>
    );
  }
  return <NonOwnerHome isWorkspaceViewer={false} />;
}

function ArtifactPage({ requestedSlug }: { requestedSlug?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = cleanSlug(requestedSlug ?? params.slug ?? "");
  return <ArtifactFrame key={slug} slug={slug} />;
}

function AppContent() {
  const location = useLocation();
  const requestedSlug = cleanSlug(
    new URLSearchParams(location.search).get("artifact") ?? ""
  );
  const isArtifactRoute =
    location.pathname.startsWith("/a/") ||
    (location.pathname === "/" && Boolean(requestedSlug));

  useEffect(() => {
    if (!isArtifactRoute) {
      document.title = DEFAULT_DOCUMENT_TITLE;
    }
  }, [isArtifactRoute]);

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f5f5f5] selection:bg-[#de5e1e] selection:text-white">
      <div className="relative">
        {isArtifactRoute ? null : <AppHeader />}
        <Routes>
          <Route
            element={requestedSlug ? <ArtifactPage requestedSlug={requestedSlug} /> : <RootPage />}
            path="/"
          />
          <Route element={<ArtifactPage />} path="/a/:slug" />
          <Route element={<main className="mx-auto max-w-xl px-6 py-24 text-center"><h1 className="text-4xl font-semibold text-white">Not found</h1><Link className="mt-5 inline-block text-[#de5e1e] hover:text-[#ed7134]" to="/">Back home</Link></main>} path="*" />
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
