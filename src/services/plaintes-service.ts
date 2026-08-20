import { apiRequest } from "../lib/api-client"

/**
 * Depot d'une plainte vocale laissee sur la touche 0 d'un centre vocal.
 *
 * ⚠️ Le contrat vit cote serveur (`src/app/api/complaints/route.ts`). Ce service
 * ne fait que le traduire, il n'ajoute aucune regle. Miroir exact de
 * `PlaintesRepository` cote mobile — les deux clients parlent la meme langue au
 * meme endroit, et toute evolution du format se decide sur le serveur d'abord.
 *
 * 🔴 `cleEnvoi` REND LE DEPOT IDEMPOTENT, et elle vient du CLIENT. Une cle par
 * enregistrement, conservee jusqu'a la reussite : un reessai apres echec reseau,
 * un double clic sur « Envoyer », ou une reponse perdue en route ne peuvent pas
 * produire deux plaintes. Le serveur rend alors 200 avec la plainte deja
 * enregistree, ce qui n'est pas une erreur — du point de vue de l'appelant elle
 * est bien partie, et c'est vrai.
 */
export async function deposerPlainte(params: {
  centerId: string
  mediaId: string
  cleEnvoi: string
  dureeMs?: number
}): Promise<void> {
  // `apiRequest` accepte un objet directement — il s'occupe de l'encodage, de
  // l'en-tete d'authentification et du rejeu apres rafraichissement du jeton.
  await apiRequest("/api/complaints", {
    method: "POST",
    body: {
      centerId: params.centerId,
      mediaId: params.mediaId,
      cleEnvoi: params.cleEnvoi,
      ...(params.dureeMs != null ? { dureeMs: params.dureeMs } : {}),
    },
  })
}
