import { ParseManager } from "./knowledge.parser.manager.js"

export async function handleParseAll(traceId: string): Promise<void> {
  const m = new ParseManager(traceId)
  await m.parseAll()
}

export async function handleParseOne(key: string, traceId: string): Promise<void> {
  const m = new ParseManager(traceId)
  await m.parseOne(key)
}
