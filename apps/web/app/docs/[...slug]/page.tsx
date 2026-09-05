import { notFound } from "next/navigation"
import { loadDocument, listSlugs } from "@/lib/data-loader"

export const revalidate = 3600

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  const slugs = await listSlugs()
  // Build all 7492 for full static, but limit to 500 for Vercel build time (rest ISR)
  return slugs.slice(0, 500).map((s) => ({ slug: s.split("/") }))
}

export default async function DocPage(props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params
  const slug = (params.slug ?? []).join("/") || "index"
  let doc
  try {
    doc = await loadDocument(slug)
  } catch {
    return notFound()
  }

  return (
    <div style={{ display: "flex", gap: 24, maxWidth: 1280, margin: "0 auto", padding: 24 }}>
      <aside style={{ width: 240, flexShrink: 0, position: "sticky", top: 24, alignSelf: "flex-start", maxHeight: "calc(100vh - 48px)", overflow: "auto", borderRight: "1px solid #e5e7eb", paddingRight: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 13, color: "#111827" }}>On this page</div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {doc.sections.slice(0, 30).map((s) => (
            <li key={s.id} style={{ fontSize: 13, paddingLeft: (s.level - 1) * 8, lineHeight: 1.4 }}>
              <a href={`#${s.id}`} style={{ color: "#4b5563", textDecoration: "none" }}>{s.heading || s.id}</a>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
          <div><a href={doc.sourceUrl} target="_blank" style={{ color: "#2563eb" }}>gnu.org source</a></div>
          <div style={{ marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>{doc.sha256.slice(0, 12)}</div>
          <div style={{ marginTop: 4 }}>{doc.wordCount ?? 0} words • {doc.sections.length} sections</div>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, background: "white" }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8, lineHeight: 1.2, color: "#111827" }}>{doc.title}</h1>
        <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 24, wordBreak: "break-all" }}>{doc.sourceUrl} • {new Date(doc.parsedAt).toLocaleDateString()}</div>
        <div style={{ display: "grid", gap: 32 }}>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} style={{ scrollMarginTop: 24 }}>
              {s.level === 1 ? <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: "#111827" }}>{s.heading}</h1> : null}
              {s.level === 2 ? <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, color: "#1f2937" }}>{s.heading}</h2> : null}
              {s.level > 2 ? <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "#374151" }}>{s.heading}</h3> : null}
              <div style={{ color: "#1f2937", lineHeight: 1.75, fontSize: 15, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{s.content.slice(0, 4000)}</div>
              {s.codeBlocks?.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {s.codeBlocks.map((cb, i) => (
                    <pre key={i} style={{ background: "#0f172a", color: "#e2e8f0", padding: 14, borderRadius: 10, overflow: "auto", fontSize: 13, lineHeight: 1.6, border: "1px solid #1e293b" }}>
                      <code style={{ fontFamily: "ui-monospace, monospace" }}>{cb.code}</code>
                    </pre>
                  ))}
                </div>
              ) : null}
              {s.media?.length ? (
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {s.media.slice(0, 4).map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src.startsWith("/api/") ? src : `/api/media?key=${encodeURIComponent(src.replace(/^https:\/\/[^/]+\//, ""))}`} alt="" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, border: "1px solid #e5e7eb", background: "#f9fafb" }} loading="lazy" />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
