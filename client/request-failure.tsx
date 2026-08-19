export function RequestFailure({
  title,
  error,
  retry,
  fullHeight = false
}: {
  title: string;
  error: Error;
  retry: () => void;
  fullHeight?: boolean;
}) {
  return (
    <main
      className={`mx-auto grid max-w-xl place-content-center px-6 py-24 text-center ${fullHeight ? "min-h-screen" : "min-h-[70vh]"}`}
      role="alert"
    >
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-3 text-slate-400">{error.message}</p>
      <button
        className="mx-auto mt-6 rounded-lg bg-[#de5e1e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ed7134]"
        onClick={retry}
        type="button"
      >
        Try again
      </button>
    </main>
  );
}
