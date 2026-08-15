import { useState } from "react"

interface CallRatingModalProps {
  idHist: string
  onClose: () => void
  onSuccess?: () => void
}

/**
 * Modal d'évaluation post-appel (Note 1 à 5 étoiles + Commentaire).
 */
export function CallRatingModal({ idHist, onClose, onSuccess }: CallRatingModalProps) {
  const [rating, setRating] = useState<number>(5)
  const [comment, setComment] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<boolean>(false)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem("access_token") ?? ""
      const res = await fetch("/api/queue/rate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          idHist,
          note: rating,
          avisCommentaire: comment.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? "Erreur lors de l'envoi de la note")
      }

      setSubmitted(true)
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err?.message ?? "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: "#1F2C34",
          color: "#FFFFFF",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          textAlign: "center",
        }}
      >
        {submitted ? (
          <div>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✨</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>
              Merci pour votre évaluation !
            </h3>
            <p style={{ fontSize: 14, opacity: 0.75, margin: 0 }}>
              Votre avis a été enregistré avec succès.
            </p>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>
              Évaluez votre appel
            </h3>
            <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 20px 0" }}>
              Comment s'est passée votre communication avec l'agent ?
            </p>

            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  marginBottom: 16,
                  borderRadius: 10,
                  backgroundColor: "rgba(229, 57, 53, 0.2)",
                  color: "#E53935",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            {/* Étoiles 1 à 5 */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 36,
                    cursor: "pointer",
                    color: star <= rating ? "#F59E0B" : "rgba(255, 255, 255, 0.25)",
                    transition: "transform 150ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Zone de texte commentaire */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Un commentaire ou une remarque ? (optionnel)"
              rows={3}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                backgroundColor: "#2A3942",
                border: "none",
                color: "#FFFFFF",
                fontSize: 14,
                resize: "none",
                boxSizing: "border-box",
                outline: "none",
                marginBottom: 20,
              }}
            />

            {/* Actions */}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  backgroundColor: "transparent",
                  color: "rgba(255, 255, 255, 0.6)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Passer
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  backgroundColor: "#F59E0B",
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: loading ? "wait" : "pointer",
                  boxShadow: "0 4px 12px rgba(245, 158, 11, 0.3)",
                }}
              >
                {loading ? "..." : "Envoyer"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
