import { ValidationManager } from "./knowledge.validator.manager.js"

export async function handleValidateAll(traceId: string): Promise<void> {
  const m = new ValidationManager(traceId)
  const res = await m.validateAll()
  if (!res.ok) throw new Error(`validation failed: ${JSON.stringify(res)}`)
}
