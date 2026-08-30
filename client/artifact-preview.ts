const PREVIEW_HEAD = `<base href="about:srcdoc">
<script>
  document.addEventListener("click", (event) => {
    const link = event.composedPath().find(
      (element) => element instanceof HTMLAnchorElement
    );
    const href = link?.getAttribute("href")?.trimStart();
    if (
      !link ||
      !href ||
      (link.protocol !== "http:" &&
        link.protocol !== "https:" &&
        !href.startsWith("//"))
    ) {
      return;
    }

    link.target = "_blank";
    link.relList.remove("opener");
    link.relList.add("noopener", "noreferrer");
  }, true);
</script>`;

export function prepareArtifactPreview(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const insertionPoint = head.index + head[0].length;
    return `${html.slice(0, insertionPoint)}${PREVIEW_HEAD}${html.slice(insertionPoint)}`;
  }

  const documentElement = /<html(?:\s[^>]*)?>/i.exec(html);
  if (documentElement) {
    const insertionPoint = documentElement.index + documentElement[0].length;
    return `${html.slice(0, insertionPoint)}<head>${PREVIEW_HEAD}</head>${html.slice(insertionPoint)}`;
  }

  const doctype = /<!doctype(?:\s[^>]*)?>/i.exec(html);
  if (doctype) {
    const insertionPoint = doctype.index + doctype[0].length;
    return `${html.slice(0, insertionPoint)}<head>${PREVIEW_HEAD}</head>${html.slice(insertionPoint)}`;
  }

  return `<head>${PREVIEW_HEAD}</head>${html}`;
}
