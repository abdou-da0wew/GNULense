import { getConfig } from "../config/index.js"

type GithubPutResult = { cdnUrl: string; rawUrl: string; sha: string }

function githubHeaders(): Record<string, string> {
  const token = getConfig().github.token
  if (!token) throw new Error("GITHUB_TOKEN not set")
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
}

export async function githubExists(path: string): Promise<string | null> {
  const cfg = getConfig().github
  const url = `https://api.github.com/repos/${cfg.mediaRepo}/contents/${encodeURI(path)}?ref=${cfg.mediaBranch}`
  const res = await fetch(url, { headers: githubHeaders() })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub exists check failed ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { sha: string }
  return data.sha
}

export async function githubPutMedia(path: string, bytes: Uint8Array, message: string): Promise<GithubPutResult> {
  const cfg = getConfig().github
  const existingSha = await githubExists(path)
  const content = Buffer.from(bytes).toString("base64")
  const body: Record<string, unknown> = {
    message,
    content,
    branch: cfg.mediaBranch,
  }
  if (existingSha) body.sha = existingSha

  const url = `https://api.github.com/repos/${cfg.mediaRepo}/contents/${encodeURI(path)}`
  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GitHub PUT failed ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { content: { sha: string }, commit: { sha: string } }
  const rawUrl = `https://raw.githubusercontent.com/${cfg.mediaRepo}/${cfg.mediaBranch}/${path}`
  const cdnUrl = `https://cdn.jsdelivr.net/gh/${cfg.mediaRepo}@${data.commit.sha}/${path}`
  return { rawUrl, cdnUrl, sha: data.content.sha }
}

export function githubMediaPathForHash(sha256: string, ext: string): string {
  const cleanExt = ext.startsWith(".") ? ext : `.${ext}`
  return `media/${sha256.slice(0, 2)}/${sha256}${cleanExt}`
}
