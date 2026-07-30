import { useEffect, useState } from "react"

/**
 * Indique si un flux distant transporte reellement une image exploitable.
 *
 * Pourquoi ce hook : `Boolean(remoteStream)` ne suffit pas. En WebRTC, les
 * pistes arrivent l'une apres l'autre (l'audio d'abord, la video ensuite) et
 * une piste video distante nait `muted` tant qu'aucune image n'est recue. Si
 * l'interlocuteur coupe sa camera, sa piste reste `live` mais repasse `muted`.
 *
 * Dans ces trois cas, un <video> branche sur le flux n'affiche qu'un rectangle
 * noir. On s'appuie donc sur l'etat reel des pistes, et on se re-evalue sur
 * `addtrack` / `removetrack` / `mute` / `unmute` / `ended`, evenements que le
 * navigateur emet des que la situation change.
 */
export function useHasLiveVideo(stream: MediaStream | null | undefined): boolean {
  const [hasVideo, setHasVideo] = useState(false)

  useEffect(() => {
    if (!stream) {
      setHasVideo(false)
      return
    }

    const evaluate = () => {
      setHasVideo(
        stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted)
      )
    }

    const watched: MediaStreamTrack[] = []
    const watch = (track: MediaStreamTrack) => {
      watched.push(track)
      track.addEventListener("mute", evaluate)
      track.addEventListener("unmute", evaluate)
      track.addEventListener("ended", evaluate)
    }

    const onAddTrack = (event: MediaStreamTrackEvent) => {
      if (event.track.kind === "video") watch(event.track)
      evaluate()
    }

    stream.getVideoTracks().forEach(watch)
    stream.addEventListener("addtrack", onAddTrack)
    stream.addEventListener("removetrack", evaluate)
    evaluate()

    return () => {
      stream.removeEventListener("addtrack", onAddTrack)
      stream.removeEventListener("removetrack", evaluate)
      for (const track of watched) {
        track.removeEventListener("mute", evaluate)
        track.removeEventListener("unmute", evaluate)
        track.removeEventListener("ended", evaluate)
      }
    }
  }, [stream])

  return hasVideo
}
