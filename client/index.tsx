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
import { useMemo, useState } from "preact/hooks";
import type app from "../server";
import {
  MAX_ARTIFACT_BYTES,
  chunkHtml,
  cleanSlug,
  isOwnerEmail
} from "../shared/config";

const client = createClient<typeof app>();

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
  const setShares = client.useMutation("setArtifactShares");
  const deleteArtifact = client.useMutation("deleteArtifact");
  const [emails, setEmails] = useState(artifact.sharedWith.join("\n"));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/a/${artifact.slug}`;

  async function saveShares() {
    setBusy(true);
    setStatus("");
    try {
      const values = emails.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
      const saved = await setShares(artifact.id, values);
      setEmails(saved.join("\n"));
      setStatus("Sharing updated.");
    } catch (caught) {
      setStatus(messageFromError(caught));
    } finally {
      setBusy(false);
    }
  }

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
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${artifact.sharedWith.length ? "bg-cyan-300/10 text-cyan-200" : "bg-white/5 text-slate-400"}`}>
          {artifact.sharedWith.length ? `Shared with ${artifact.sharedWith.length}` : "Only you"}
        </span>
      </div>

      <div className="mt-5 grid gap-3">
        <label className="text-xs font-medium text-slate-400">
          Share with emails <span className="font-normal text-slate-600">(one per line)</span>
          <textarea className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-cyan-400/60" onInput={(event) => setEmails(event.currentTarget.value)} placeholder="teammate@example.com" value={emails} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-100 disabled:opacity-50" disabled={busy} onClick={() => void saveShares()} type="button">Save sharing</button>
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

function ArtifactFrame() {
  const { slug = "" } = useParams<{ slug: string }>();
  const artifact = client.useQuery("artifactBySlug", slug);
  const [copied, setCopied] = useState(false);
  const downloadUrl = useMemo(() => {
    if (!artifact) return "";
    return URL.createObjectURL(new Blob([artifact.html], { type: "text/html;charset=utf-8" }));
  }, [artifact?.html]);

  if (artifact === undefined) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Opening artifact…</main>;
  }
  if (artifact === null) {
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
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/30" onClick={() => void copySource()} type="button">{copied ? "Copied" : "Copy source"}</button>
          <a className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-200" download={`${artifact.slug}.html`} href={downloadUrl}>Download HTML</a>
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:border-white/30 hover:text-white" onClick={() => signOut()} type="button">Sign out</button>
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
  return isOwnerEmail(auth.email ?? "") ? <OwnerDashboard /> : <NonOwnerHome />;
}

function ArtifactPage() {
  const auth = useAuth();
  if (auth.isLoading) return <main className="grid min-h-[70vh] place-items-center text-slate-500">Checking session…</main>;
  if (auth.isGuest) return <SignInCard shared />;
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
