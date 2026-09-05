export const runtime = "edge"
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const key = url.searchParams.get("key")
  if (!key) return new Response(JSON.stringify({ error: "MISSING_KEY" }), { status: 400, headers: { "content-type": "application/json" } })
  if (!key.startsWith("media/") && !key.startsWith("raw/") && !key.startsWith("processed/")) {
    return new Response(JSON.stringify({ error: "INVALID_KEY" }), { status: 400 })
  }
  const endpoint = process.env.TIGRIS_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3 ?? "https://t3.storage.dev"
  const bucket = key.startsWith("media/") ? (process.env.TIGRIS_BUCKET_RAW ?? "gnu-lens-raw") : key.startsWith("processed/") ? (process.env.TIGRIS_BUCKET_PROCESSED ?? "gnu-lens-processed") : (process.env.TIGRIS_BUCKET_RAW ?? "gnu-lens-raw")
  const accessKey = process.env.TIGRIS_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID
  const secretKey = process.env.TIGRIS_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKey || !secretKey) return new Response(JSON.stringify({ error: "NOT_CONFIGURED" }), { status: 500 })
  const region = process.env.TIGRIS_REGION ?? process.env.AWS_REGION ?? "auto"
  try {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3")
    const { getSignedUrl } = await import("@aws-sdk/s3-presigner")
    const client = new S3Client({ region, endpoint, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }, forcePathStyle: false })
    const signedUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 })
    return Response.redirect(signedUrl, 302)
  } catch (e) {
    return new Response(JSON.stringify({ error: "SIGN_FAILED", details: String(e).slice(0,300) }), { status: 500, headers: { "content-type": "application/json" } })
  }
}
