export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, Inter, sans-serif", maxWidth: 1100, margin: "0 auto", padding: 24 }}>{children}</body>
    </html>
  )
}
