export interface Country {
  idPays: number
  code: string
  nom: string
  indicatif: string
}

export const PAYS_LIST: Country[] = [
  { idPays: 1, code: "CM", nom: "Cameroun", indicatif: "+237" },
  { idPays: 2, code: "FR", nom: "France", indicatif: "+33" },
  { idPays: 3, code: "CI", nom: "Côte d'Ivoire", indicatif: "+225" },
  { idPays: 4, code: "SN", nom: "Sénégal", indicatif: "+221" },
  { idPays: 5, code: "CA", nom: "Canada", indicatif: "+1" },
  { idPays: 6, code: "US", nom: "États-Unis", indicatif: "+1" },
  { idPays: 7, code: "BE", nom: "Belgique", indicatif: "+32" },
  { idPays: 8, code: "CH", nom: "Suisse", indicatif: "+41" },
  { idPays: 9, code: "GA", nom: "Gabon", indicatif: "+241" },
  { idPays: 10, code: "CG", nom: "Congo (Brazzaville)", indicatif: "+242" },
  { idPays: 11, code: "CD", nom: "RD Congo", indicatif: "+243" },
  { idPays: 12, code: "MA", nom: "Maroc", indicatif: "+212" },
]
