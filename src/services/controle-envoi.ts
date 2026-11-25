/**
 * METTRE UN TRANSFERT EN PAUSE, ET LE REPRENDRE — web.
 *
 * 🔴 DEMANDE DU USER, 25/11/2026 : « on doit pouvoir mettre pause à un envoi
 * ou même à un téléchargement ». Avec un plafond passé à 500 Mo, un transfert
 * peut occuper la ligne plusieurs minutes ; sans pause, le seul moyen de
 * libérer la connexion pour un appel ou un message urgent était d'annuler et
 * de tout recommencer.
 *
 * 🔴 UNE PAUSE COUPE LES OCTETS EN VOL, elle ne fait pas que lever un drapeau.
 * Marquer « en pause » et attendre la fin du morceau courant laisserait monter
 * jusqu'à un mébioctet après le clic : sur une connexion lente, dix secondes
 * pendant lesquelles l'utilisateur voit « en pause » et constate que rien ne
 * se libère. La requête en vol est donc INTERROMPUE, et son morceau repart
 * entier à la reprise — le serveur n'enregistre que les morceaux complets, il
 * n'y a rien à perdre.
 *
 * ⚠️ UNE PAUSE NE SURVIT PAS À LA SESSION (décision du user, 25/11/2026 :
 * « si la session est fermée, la pause meurt aussi »). Rien n'est écrit sur le
 * disque : cet état vit en mémoire. Onglet fermé, l'envoi redevient un envoi
 * coupé ordinaire, que la reprise par morceaux sait déjà rattraper.
 *
 * ⚠️ CE N'EST PAS UNE ANNULATION. Une pause n'use aucun réessai et ne remonte
 * aucune erreur : l'envoyeur attend, il n'échoue pas. Sans cette distinction,
 * mettre en pause plus de cinq fois aurait épuisé les réessais du morceau et
 * fait échouer l'envoi comme une panne réseau.
 */

export class ControleTransfert {
  private pausee = false
  /** Les reprises à libérer : un `resolve` par point de contrôle en attente. */
  private attentes: Array<() => void> = []
  /** De quoi couper ce qui est en vol — une entrée par requête en cours. */
  private arrets = new Set<() => void>()
  private ecouteurs = new Set<(enPause: boolean) => void>()

  get enPause(): boolean {
    return this.pausee
  }

  pause(): void {
    if (this.pausee) return
    this.pausee = true
    // Copie : un `arret` se retire de l'ensemble en s'exécutant.
    for (const arret of [...this.arrets]) {
      try {
        arret()
      } catch {
        /* une requête déjà finie : rien à couper */
      }
    }
    this.prevenir()
  }

  reprendre(): void {
    if (!this.pausee) return
    this.pausee = false
    const attentes = this.attentes
    this.attentes = []
    for (const liberer of attentes) liberer()
    this.prevenir()
  }

  basculer(): void {
    if (this.pausee) this.reprendre()
    else this.pause()
  }

  /**
   * Le POINT DE CONTRÔLE, à appeler avant chaque morceau : rend la main tout de
   * suite quand rien n'est en pause, attend la reprise sinon.
   */
  point(): Promise<void> {
    if (!this.pausee) return Promise.resolve()
    return new Promise<void>((liberer) => {
      this.attentes.push(liberer)
    })
  }

  /**
   * Inscrit de quoi interrompre une requête en vol ; rend la fonction qui
   * retire cette inscription.
   *
   * ⚠️ LE RETRAIT EST OBLIGATOIRE à la fin de la requête, succès ou échec :
   * sans lui, une pause tardive appellerait `abort()` sur des requêtes déjà
   * terminées, et l'ensemble grossirait d'un morceau à l'autre.
   */
  inscrire(arret: () => void): () => void {
    this.arrets.add(arret)
    return () => {
      this.arrets.delete(arret)
    }
  }

  surChangement(f: (enPause: boolean) => void): () => void {
    this.ecouteurs.add(f)
    return () => {
      this.ecouteurs.delete(f)
    }
  }

  private prevenir(): void {
    for (const f of [...this.ecouteurs]) {
      try {
        f(this.pausee)
      } catch {
        /* un écouteur qui jette ne doit pas bloquer les autres */
      }
    }
  }
}
