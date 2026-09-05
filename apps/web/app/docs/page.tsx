import Link from "next/link"
import { listSlugsWithMeta } from "@/lib/data-loader"

export const revalidate = 3600

export default async function DocsIndex() {
  const items = await listSlugsWithMeta()
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui, Inter, sans-serif" }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>GNULense Docs</h1>
      <p style={{ color: "#6b7280", marginBottom: 8 }}>Clean lens over gnu.org — {items.length} docs indexed, super fast Edge</p>
      <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 24 }}>All 7492 HTML + media via Tigris + Mongo, instant via Edge manifest</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {items.map(({ slug, title }) => (
          <Link key={slug} href={`/docs/${slug}`} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, textDecoration: "none", color: "inherit", display: "block", background: "white" }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#111827", wordBreak: "break-all" }}>{title}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, wordBreak: "break-all" }}>{slug}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
