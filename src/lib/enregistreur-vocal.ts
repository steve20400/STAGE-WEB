/**
 * UN ENREGISTREMENT AU MICRO, rendu en fichier (01/11/2026).
 *
 * Pour le statut audio et la reponse vocale a un statut. Meme format que les
 * vocaux de la discussion (`chat.tsx`) : Opus en WebM si le navigateur le sait,
 * sinon AAC en MP4.
 */
export interface EnregistrementVocal {
  /** Arrete et rend l'audio, ou `null` s'il est vide. */
  arreter(): Promise<{ fichier: File; dureeMs: number } | null>
  /** Arrete sans rien garder. */
  annuler(): void
  /** L'heure du debut, pour afficher le temps ecoule. */
  readonly debut: number
}

/** LEVE si le micro est refuse ou absent. */
export async function demarrerEnregistrementVocal(nom: string): Promise<EnregistrementVocal> {
  const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : ""
  const rec = mime ? new MediaRecorder(flux, { mimeType: mime }) : new MediaRecorder(flux)
  const morceaux: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) morceaux.push(e.data)
  }
  const debut = Date.now()
  rec.start()
  const couperMicro = () => flux.getTracks().forEach((piste) => piste.stop())

  return {
    debut,
    arreter: () =>
      new Promise((resolve) => {
        if (rec.state === "inactive") {
          couperMicro()
          resolve(null)
          return
        }
        rec.onstop = () => {
          couperMicro()
          // Le serveur valide le MIME exact : sans le suffixe « ;codecs=… ».
          const type = (rec.mimeType || "audio/webm").split(";")[0]
          const blob = new Blob(morceaux, { type })
          if (blob.size === 0) {
            resolve(null)
            return
          }
          const ext = type.includes("mp4") ? "m4a" : "webm"
          resolve({
            fichier: new File([blob], `${nom}-${Date.now()}.${ext}`, { type }),
            // L'horloge, pas les metadonnees : un WebM enregistre par le
            // navigateur annonce une duree infinie.
            dureeMs: Date.now() - debut,
          })
        }
        rec.stop()
      }),
    annuler: () => {
      rec.onstop = null
      if (rec.state !== "inactive") rec.stop()
      couperMicro()
    },
  }
}

/** La duree d'un fichier audio ou video choisi, lue par le navigateur ; 0 si inconnue. */
export function lireDureeMs(fichier: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier)
    const lecteur = document.createElement("audio")
    lecteur.preload = "metadata"
    const fin = (ms: number) => {
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    lecteur.onloadedmetadata = () =>
      fin(Number.isFinite(lecteur.duration) ? Math.round(lecteur.duration * 1000) : 0)
    lecteur.onerror = () => fin(0)
    lecteur.src = url
  })
}
