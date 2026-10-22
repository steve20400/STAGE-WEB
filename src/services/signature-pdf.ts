/**
 * PDF SIGNÉ D'UN DOCUMENT SENSIBLE (22/10/2026) — pendant web de
 * `SignatureDocument.kt` du mobile.
 *
 * Le texte de la signature est écrit aux QUATRE BORDS de chaque page (par-
 * dessus le contenu, rien n'est effacé), et le dictionnaire Info reçoit
 * Creator, Producer, Subject, Keywords et des clés `Alanya…`, visibles dans
 * les propriétés du document.
 *
 * pdf-lib (MIT) n'est chargé qu'au premier PDF signé. Un PDF chiffré lève
 * ici : l'appelant laisse alors la copie sortir telle quelle.
 */

/** Rouge des documents sensibles (#E53935). */
const ROUGE = { r: 0xe5 / 255, g: 0x39 / 255, b: 0x35 / 255 }

export async function signerPdf(
  octets: ArrayBuffer,
  texte: string,
  meta: Record<string, string>,
): Promise<Uint8Array> {
  const { PDFDocument, PDFDict, PDFHexString, PDFName, StandardFonts, degrees, rgb } = await import("pdf-lib")
  // `updateMetadata: false` : pdf-lib n'écrit pas son propre nom par-dessus.
  const doc = await PDFDocument.load(octets, { updateMetadata: false })
  const police = await doc.embedFont(StandardFonts.HelveticaBold)
  // Helvetica ne connaît que le jeu Windows-1252 : un caractère hors jeu
  // devient « ? » plutôt que de faire échouer toute la signature.
  const ecrit = Array.from(texte, (c) => {
    try {
      police.encodeText(c)
      return c
    } catch {
      return "?"
    }
  }).join("")
  const unite = police.widthOfTextAtSize(ecrit, 1)
  const couleur = rgb(ROUGE.r, ROUGE.g, ROUGE.b)

  for (const page of doc.getPages()) {
    const { x, y, width: l, height: h } = page.getCropBox()
    const base = Math.min(9, Math.max(5, Math.min(l, h) / 75))
    const marge = base * 0.9
    // Réduite si le bord est trop court pour la ligne entière.
    const taillePour = (longueur: number) => Math.min(base, (longueur - 2 * marge) / unite)
    const tH = taillePour(l)
    const tV = taillePour(h)
    const commun = { font: police, color: couleur, opacity: 0.85 }
    // Haut et bas, centrés.
    page.drawText(ecrit, { ...commun, size: tH, x: x + (l - unite * tH) / 2, y: y + h - marge - tH * 0.75 })
    page.drawText(ecrit, { ...commun, size: tH, x: x + (l - unite * tH) / 2, y: y + marge + tH * 0.2 })
    // Gauche : lu de bas en haut. Droite : lu de haut en bas.
    page.drawText(ecrit, {
      ...commun,
      size: tV,
      x: x + marge + tV * 0.75,
      y: y + (h - unite * tV) / 2,
      rotate: degrees(90),
    })
    page.drawText(ecrit, {
      ...commun,
      size: tV,
      x: x + l - marge - tV * 0.75,
      y: y + (h + unite * tV) / 2,
      rotate: degrees(-90),
    })
  }

  const application = meta.AlanyaApplication ?? "Alanya Work"
  doc.setCreator(application)
  doc.setProducer(application)
  doc.setSubject(texte)
  doc.setKeywords(
    [application, meta.AlanyaID && `Alanya ${meta.AlanyaID}`, meta.AlanyaTrace && `Trace ${meta.AlanyaTrace}`].filter(
      (k): k is string => Boolean(k),
    ),
  )
  // Les clés `Alanya…` dans le dictionnaire Info (créé par les appels ci-dessus).
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict)
  for (const [cle, valeur] of Object.entries(meta)) {
    info.set(PDFName.of(cle), PDFHexString.fromText(valeur))
  }
  return doc.save()
}
