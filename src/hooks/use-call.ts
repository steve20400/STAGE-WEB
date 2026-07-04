import { useSyncExternalStore } from "react"
import { getCallState, subscribeToCallState, type CallManagerState } from "../services/call-manager"

/** Etat reactif du gestionnaire d'appels WebRTC (singleton applicatif). */
export function useCallState(): CallManagerState {
  return useSyncExternalStore(subscribeToCallState, getCallState)
}
