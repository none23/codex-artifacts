import {
  Link,
  Route,
  Router,
  Routes,
  SignInWithGoogle,
  createClient,
  signOut,
  useAuth,
  useLocation,
  useParams
} from "lakebed/client";
import { useEffect, useMemo, useState } from "preact/hooks";
import type app from "../server";
import {
  MAX_ARTIFACT_BYTES,
  chunkHtml,
  cleanSlug,
  isValidDomain,
  isValidEmail,
  normalizeDomain,
  normalizeEmail
} from "../shared/config";

const client = createClient<typeof app>();
const KNOWN_EMAILS_KEY = "codex-artifacts:known-emails";

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

function slugFromTitle(title: string): string {
  const base = cleanSlug(title) || "artifact";
  return `${base}-${Date.now().toString(36)}`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
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

function accessLabel(access: { isPublic: boolean; sharedWith: string[]; sharedDomains: string[] }): string {
  if (access.isPublic) return "Public";
  const rules = access.sharedWith.length + access.sharedDomains.length;
  if (!rules) return "Owners only";
  return `${rules} access rule${rules === 1 ? "" : "s"}`;
}

function SignInCard({ shared = false }: { shared?: boolean }) {
  return (
    <section className={`mx-auto flex max-w-xl items-center px-6 py-16 ${shared ? "min-h-screen" : "min-h-[70vh]"}`}>
      <div className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-cyan-950/20 backdrop-blur">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Private workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          {shared ? "Sign in to open this artifact" : "Your Codex artifacts, in one quiet place."}
        </h1>
        <p className="mt-4 leading-7 text-slate-400">
          Access is checked against a verified Google email. Shared links do not make their contents public.
        </p>
        <SignInWithGoogle className="mt-8 inline-flex items-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100" />
      </div>
    </section>
  );
}

function AppHeader() {
  const auth = useAuth();
  return (
    <header className="border-b border-white/10 bg-slate-950/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link className="flex items-center gap-3" to="/">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-500 font-mono text-sm font-black text-slate-950">A</span>
          <span>
            <span className="block text-sm font-semibold text-white">Codex Artifacts</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">private by default</span>
          </span>
        </Link>
        {!auth.isGuest && !auth.isLoading ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden max-w-64 truncate text-sm text-slate-400 sm:block">{auth.email ?? auth.displayName}</span>
            <button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/30 hover:text-white" onClick={() => signOut()} type="button">Sign out</button>
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

  async function submit(event: SubmitEvent) {
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
      const result = await publishArtifact({ title, slug, chunks: chunkHtml(html) });
      const url = `${window.location.origin}/a/${result.slug}`;
      setNotice(url);
      form.reset();
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02]">
      <div className="grid gap-8 p-6 md:grid-cols-[1fr_auto] md:items-end md:p-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-300">New artifact</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Publish an HTML file</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Only you can see it until you add verified Google emails. Maximum {formatBytes(MAX_ARTIFACT_BYTES)}.</p>
        </div>
        <form className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => void submit(event)}>
          <label className="grid gap-1.5 text-xs font-medium text-slate-400">
            Title (optional)
            <input className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/70" name="title" placeholder="Architecture review" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-400">
            HTML file
            <input accept=".html,.htm,text/html" className="h-11 max-w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 file:mr-3 file:border-0 file:bg-transparent file:text-cyan-300" name="file" required type="file" />
          </label>
          <button className="h-11 self-end rounded-xl bg-cyan-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60" disabled={busy} type="submit">{busy ? "Publishing…" : "Publish"}</button>
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

type OwnedArtifact = NonNullable<ReturnType<typeof client.useQuery<"ownedArtifacts">>>[number];

function ArtifactCard({ artifact }: { artifact: OwnedArtifact }) {
  const publishArtifact = client.useMutation("publishArtifact");
  const deleteArtifact = client.useMutation("deleteArtifact");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/a/${artifact.slug}`;

  async function replace(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus("");
    try {
      await publishArtifact({
        artifactId: artifact.id,
        title: artifact.title,
        slug: artifact.slug,
        chunks: chunkHtml(await file.text()),
        sharedWith: artifact.sharedWith
      });
      setStatus("HTML replaced.");
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
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-white/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link className="block truncate text-lg font-semibold text-white hover:text-cyan-200" to={`/a/${artifact.slug}`}>{artifact.title}</Link>
          <p className="mt-1 font-mono text-xs text-slate-500">{formatBytes(Number(artifact.sizeBytes))} · updated {formatDate(artifact.updatedAt)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${artifact.isPublic ? "bg-emerald-300/10 text-emerald-200" : artifact.sharedWith.length || artifact.sharedDomains.length ? "bg-cyan-300/10 text-cyan-200" : "bg-white/5 text-slate-400"}`}>
          {accessLabel(artifact)}
        </span>
      </div>

      <div className="mt-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-100" to={`/a/${artifact.slug}`}>Open & manage access</Link>
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:border-white/30" onClick={() => void navigator.clipboard.writeText(url)} type="button">Copy link</button>
          <label className="cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:border-white/30">
            Replace HTML
            <input accept=".html,.htm,text/html" className="hidden" disabled={busy} onChange={(event) => void replace(event.currentTarget.files?.[0])} type="file" />
          </label>
          <button className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-400/10 disabled:opacity-50" disabled={busy} onClick={() => void remove()} type="button">Delete</button>
        </div>
        {status ? <p className="text-xs text-slate-400">{status}</p> : null}
      </div>
    </article>
  );
}

function OwnerDashboard() {
  const artifacts = client.useQuery("ownedArtifacts");
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <NewArtifactForm />
      <section className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Library</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Published artifacts</h1>
          </div>
          <span className="text-sm text-slate-500">{artifacts?.length ?? 0} total</span>
        </div>
        {!artifacts ? (
          <div className="rounded-2xl border border-white/10 p-8 text-center text-slate-500">Loading artifacts…</div>
        ) : artifacts.length ? (
          <div className="grid gap-4 lg:grid-cols-2">{artifacts.map((artifact) => <ArtifactCard artifact={artifact} key={artifact.id} />)}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
            <p className="text-slate-300">No artifacts yet.</p>
            <p className="mt-1 text-sm text-slate-600">Publish an HTML file above or use the automation script.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function NonOwnerHome() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">Signed in</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Open the link that was shared with you.</h1>
      <p className="mt-5 leading-7 text-slate-400">This private service does not expose a directory of artifacts. Access is granted per link and verified Google email.</p>
    </main>
  );
}

function useOwnerBootstrap() {
  const viewer = client.useQuery("viewer");
  const claimOwnerAccess = client.useMutation("claimOwnerAccess");
  const [state, setState] = useState<"idle" | "claiming" | "claimed" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!viewer || viewer.isOwner || !viewer.canClaimOwner || state !== "idle") {
      return;
    }

    setState("claiming");
    void claimOwnerAccess()
      .then((result) => {
        if (!result.claimed) {
          setError("This Google identity could not accept the configured owner invitation.");
          setState("error");
          return;
        }
        setState("claimed");
      })
      .catch((caught) => {
        setError(messageFromError(caught));
        setState("error");
      });
  }, [viewer?.isOwner, viewer?.canClaimOwner, state]);

  return { viewer, state, error };
}

type ViewedArtifact = Exclude<ReturnType<typeof client.useQuery<"artifactBySlug">>, null | undefined>;

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

  function addEmail(event: SubmitEvent) {
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
    setEmails((current) => current.includes(email) ? current : [...current, email]);
    setKnownEmails(rememberEmails([email]));
    setEmailInput("");
    setStatus("");
  }

  function addDomain(event: SubmitEvent) {
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

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/30"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Access · {accessLabel({ isPublic, sharedWith: emails, sharedDomains: domains })}
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-slate-950 p-5 text-left shadow-2xl shadow-black/50" role="dialog" aria-label="Artifact access settings">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-white">Access settings</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Changes apply to this artifact only.</p>
            </div>
            <button aria-label="Close access settings" className="text-lg leading-none text-slate-500 hover:text-white" onClick={() => setOpen(false)} type="button">×</button>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3">
            <input checked={isPublic} className="mt-0.5 h-4 w-4 accent-cyan-300" onChange={(event) => setIsPublic(event.currentTarget.checked)} type="checkbox" />
            <span>
              <span className="block text-sm font-medium text-white">Public link</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Anyone with the link can view without signing in.</span>
            </span>
          </label>

          <div className="mt-5">
            <label className="text-xs font-medium text-slate-400" htmlFor="artifact-access-email">People</label>
            <form className="mt-1.5 flex gap-2" onSubmit={(event) => addEmail(event)}>
              <input
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
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
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
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
            <button className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save access"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactFrame() {
  const auth = useAuth();
  const { slug = "" } = useParams<{ slug: string }>();
  const artifact = client.useQuery("artifactBySlug", slug);
  const acceptArtifactAccess = client.useMutation("acceptArtifactAccess");
  const ownerBootstrap = useOwnerBootstrap();
  const [accessState, setAccessState] = useState<"idle" | "accepting" | "accepted" | "denied">("idle");
  const [copied, setCopied] = useState(false);
  const downloadUrl = useMemo(() => {
    if (!artifact) return "";
    return URL.createObjectURL(new Blob([artifact.html], { type: "text/html;charset=utf-8" }));
  }, [artifact?.html]);

  useEffect(() => {
    if (
      artifact !== null ||
      auth.isLoading ||
      auth.isGuest ||
      accessState !== "idle" ||
      ownerBootstrap.state === "claiming"
    ) {
      return;
    }

    setAccessState("accepting");
    void acceptArtifactAccess(slug)
      .then((result) => setAccessState(result.accepted ? "accepted" : "denied"))
      .catch(() => setAccessState("denied"));
  }, [
    artifact,
    auth.isLoading,
    auth.isGuest,
    slug,
    accessState,
    ownerBootstrap.state
  ]);

  if (artifact === undefined) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Opening artifact…</main>;
  }
  if (artifact === null) {
    if (auth.isGuest) {
      return <SignInCard shared />;
    }
    if (
      accessState === "accepting" ||
      accessState === "accepted" ||
      ownerBootstrap.state === "claiming" ||
      ownerBootstrap.state === "claimed"
    ) {
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <Link aria-label="Back to artifacts" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-lg text-slate-300 transition hover:border-white/30 hover:text-white" to="/">←</Link>
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-white">{artifact.title}</h1>
            <p className="font-mono text-[11px] text-slate-500">{formatBytes(artifact.sizeBytes)} · sandboxed preview</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {artifact.canManage ? <AccessControl artifact={artifact} /> : null}
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/30" onClick={() => void copySource()} type="button">{copied ? "Copied" : "Copy source"}</button>
          <a className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-200" download={`${artifact.slug}.html`} href={downloadUrl}>Download HTML</a>
          {!auth.isGuest ? <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:border-white/30 hover:text-white" onClick={() => signOut()} type="button">Sign out</button> : null}
        </div>
      </header>
      <iframe
        className="min-h-[700px] flex-1 border-0 bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
        srcDoc={artifact.html}
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
  const { viewer, state, error } = useOwnerBootstrap();
  if (!viewer) {
    return <main className="grid min-h-[70vh] place-items-center text-slate-500">Loading workspace…</main>;
  }
  if (viewer.isOwner) {
    return <OwnerDashboard />;
  }
  if (state === "claiming" || state === "claimed") {
    return <main className="grid min-h-[70vh] place-items-center text-slate-500">Activating owner access…</main>;
  }
  if (state === "error") {
    return (
      <main className="mx-auto grid min-h-[70vh] max-w-xl place-content-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-white">Owner access could not be activated.</h1>
        <p className="mt-3 text-slate-400">{error}</p>
      </main>
    );
  }
  return <NonOwnerHome />;
}

function ArtifactPage() {
  return <ArtifactFrame />;
}

function AppContent() {
  const location = useLocation();
  const isArtifactRoute = location.pathname.startsWith("/a/");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-300 selection:text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(59,130,246,0.08),transparent_28%)]" />
      <div className="relative">
        {isArtifactRoute ? null : <AppHeader />}
        <Routes>
          <Route element={<RootPage />} path="/" />
          <Route element={<ArtifactPage />} path="/a/:slug" />
          <Route element={<main className="mx-auto max-w-xl px-6 py-24 text-center"><h1 className="text-4xl font-semibold text-white">Not found</h1><Link className="mt-5 inline-block text-cyan-300 hover:text-cyan-200" to="/">Back home</Link></main>} path="*" />
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
