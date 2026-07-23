/**
 * Proxy de lecture média exécuté sur Vercel (frontend uniquement).
 * Il évite que le navigateur fasse un fetch cross-origin vers une redirection B2,
 * laquelle peut ne pas exposer les en-têtes CORS nécessaires à PDF.js/au lecteur texte.
 * Le backend reste l'unique autorité : son Bearer token et ses règles d'accès sont
 * transmis sans modification.
 */
const BACKEND_URL = (process.env.VITE_API_BASE_URL || "https://backend-alanya.vercel.app").replace(/\/$/, "")

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) return res.status(400).json({ error: "Invalid media id" })
  // Les balises img/video et Office Online ne peuvent pas ajouter un header.
  // Elles transmettent donc le token déjà signé dans l'URL same-origin ; les fetch
  // applicatifs continuent à utiliser Authorization.
  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  const authorization = req.headers.authorization || (token ? `Bearer ${token}` : "")
  if (!authorization) return res.status(401).json({ error: "Authorization required" })

  try {
    // redirect: follow est essentiel : B2 est lu côté Vercel, pas par le navigateur.
    const forceDownload = req.query.download === "1" ? "?download=1" : ""
    const upstream = await fetch(`${BACKEND_URL}/api/media/${encodeURIComponent(id)}${forceDownload}`, {
      headers: { Authorization: authorization }, redirect: "follow",
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "")
      return res.status(upstream.status).send(detail || "Media unavailable")
    }
    res.status(200)
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream")
    const length = upstream.headers.get("content-length")
    if (length) res.setHeader("Content-Length", length)
    res.setHeader("Cache-Control", "private, max-age=86400")
    res.setHeader("Content-Disposition", "inline")
    const buffer = Buffer.from(await upstream.arrayBuffer())
    return res.send(buffer)
  } catch {
    return res.status(502).json({ error: "Impossible de récupérer le média depuis le stockage" })
  }
}
