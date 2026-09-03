import { githubPutMedia, githubMediaPathForHash } from "@core/platform/storage.github.js"
import crypto from "node:crypto"

export async function handlePutMedia(bytes: Uint8Array, originalUrl: string, ext: string): Promise<string> {
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex")
  const path = githubMediaPathForHash(sha256, ext)
  const { cdnUrl } = await githubPutMedia(path, bytes, `media: ${originalUrl} ${sha256.slice(0, 8)}`)
  return cdnUrl
}
