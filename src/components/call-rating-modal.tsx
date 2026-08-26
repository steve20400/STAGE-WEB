import { useState } from "react"
import { apiRequest } from "../lib/api-client"
import { useTranslation } from "../i18n"

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
  const { t } = useTranslation()
  const [comment, setComment] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<boolean>(false)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      /*
       * `apiRequest` ET NON `fetch`, et ce n'est pas un detail de style : c'est
       * ce qui empechait l'evaluation de partir.
       *
       * L'appel direct visait « /api/queue/rate » en chemin RELATIF — donc le
       * site qui sert l'application, pas l'API, qui vit sur une autre origine.
       * Et il lisait le jeton sous « access_token », une cle qui n'existe pas :
       * la session est rangee ailleurs. Deux causes, dont chacune suffisait a
       * tout bloquer ; l'utilisateur choisissait ses etoiles, cliquait, et la
       * fenetre restait la.
       *
       * `apiRequest` porte l'origine, le jeton, et rejoue la requete une fois
       * apres avoir rafraichi une session expiree — ce qu'un `fetch` a la main
       * ne fera jamais.
       */
      await apiRequest("/api/queue/rate", {
        method: "POST",
        body: { idHist, note: rating, avisCommentaire: comment.trim() },
      })

      setSubmitted(true)
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(t("rate_failed"))
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
              {t("rate_thanks")}
            </h3>
            <p style={{ fontSize: 14, opacity: 0.75, margin: 0 }}>
              {t("rate_saved")}
            </p>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px 0" }}>
              {t("rate_title")}
            </h3>
            <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 20px 0" }}>
              {t("rate_subtitle")}
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
              placeholder={t("rate_comment_ph")}
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
                {t("rate_skip")}
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
                {loading ? "..." : t("rate_send")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
