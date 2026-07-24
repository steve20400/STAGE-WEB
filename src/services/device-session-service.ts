import { apiRequest } from "../lib/api-client"
const KEY="alanya_device_id"
function id(){let v=localStorage.getItem(KEY);if(!v){v=crypto.randomUUID();localStorage.setItem(KEY,v)}return v}
function browser(){const u=navigator.userAgent;return /Firefox/i.test(u)?"Firefox":/Edg/i.test(u)?"Edge":/Chrome/i.test(u)?"Chrome":/Safari/i.test(u)?"Safari":"Navigateur"}
function os(){const u=navigator.userAgent;return /Android/i.test(u)?"Android":/iPhone|iPad/i.test(u)?"iOS":/Windows/i.test(u)?"Windows":/Mac/i.test(u)?"macOS":"Linux"}
export async function registerCurrentDevice(){return apiRequest("/api/sessions",{method:"POST",body:{id:id(),label:`${browser()} — ${os()}`,platform:"web",browser:browser(),os:os()}})}
export async function listDeviceSessions(){return apiRequest<{sessions:unknown[]}>("/api/sessions")}
export async function revokeDeviceSession(id:string){return apiRequest(`/api/sessions/${id}`,{method:"DELETE"})}
