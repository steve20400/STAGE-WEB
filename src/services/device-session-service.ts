import { apiRequest } from "../lib/api-client"
const key="alanya_device_id"
const id=()=>{let x=localStorage.getItem(key);if(!x){x=crypto.randomUUID();localStorage.setItem(key,x)}return x}
const browser=()=>/Firefox/i.test(navigator.userAgent)?"Firefox":/Edg/i.test(navigator.userAgent)?"Edge":/Chrome/i.test(navigator.userAgent)?"Chrome":/Safari/i.test(navigator.userAgent)?"Safari":"Navigateur"
const os=()=>/Android/i.test(navigator.userAgent)?"Android":/iPhone|iPad/i.test(navigator.userAgent)?"iOS":/Windows/i.test(navigator.userAgent)?"Windows":/Mac/i.test(navigator.userAgent)?"macOS":"Linux"
export const registerCurrentDevice=()=>apiRequest("/api/sessions",{method:"POST",body:{id:id(),label:`${browser()} — ${os()}`,platform:"web",browser:browser(),os:os()}})
export const fetchSessions=()=>apiRequest<{sessions:Array<{id:string;label:string;platform:string;browser?:string;os?:string;lastSeenAt:string}>}>("/api/sessions")
export const revokeSession=(id:string)=>apiRequest(`/api/sessions/${id}`,{method:"DELETE"})
