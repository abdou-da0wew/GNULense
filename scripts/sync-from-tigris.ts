import { tigrisGet } from "@core/platform/storage.tigris.js"
import fs from "node:fs/promises"

const limit = Number(process.argv[2] ?? 10)
console.log(JSON.stringify({ msg: "sync-from-tigris", limit }))
// Example: pull 10 processed docs to local data/ for debugging
for (let i = 0; i < limit; i++) {
  try {
    const key = `processed/test-${i}.json`
    const bytes = await tigrisGet(key)
    await fs.mkdir("data/processed", { recursive: true })
    await fs.writeFile(`data/processed/test-${i}.json`, bytes)
    console.log(`synced ${key}`)
  } catch {}
}
console.log(JSON.stringify({ done: true }))
