import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { hangUp, restoreActiveCall, toggleMicrophone } from "../services/call-manager"

/** Appel persistant : WebRTC reste actif lorsque l'utilisateur consulte l'application. */
export function ActiveCallFloating() {
  const call=useCallState(), nav=useNavigate(), video=useRef<HTMLVideoElement>(null)
  const [controls,setControls]=useState(false), [pos,setPos]=useState({x:0,y:0})
  const drag=useRef<{x:number;y:number;ox:number;oy:number;on:boolean}>({x:0,y:0,ox:0,oy:0,on:false})
  const remote=Object.values(call.remoteStreams)[0]
  useEffect(()=>{if(video.current&&remote) video.current.srcObject=remote},[remote])
  if(!call.activeCallId || call.displayMode!=="compact") return null
  const videoCall=call.callType==="video"
  const restore=()=>{restoreActiveCall();nav(`/calls/${call.activeCallId}?type=${call.callType}`)}
  return <div className="active-call-floating" style={{transform:`translate(${pos.x}px,${pos.y}px)`}} onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,ox:pos.x,oy:pos.y,on:true};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=drag.current;if(d.on)setPos({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y})}} onPointerUp={()=>drag.current.on=false}>
    <div className="active-call-content" onClick={()=>setControls(v=>!v)}>
      {videoCall&&remote?<video ref={video} autoPlay playsInline/>:<div className="active-call-audio"><b>{call.peerName||"Appel"}</b><span>Appel en cours</span></div>}
      {controls&&<div className="active-call-controls" onPointerDown={e=>e.stopPropagation()}><button onClick={restore}>Plein écran</button><button onClick={()=>toggleMicrophone()}>{call.micOn?"Muet":"Micro"}</button><button className="end" onClick={()=>void hangUp()}>Raccrocher</button></div>}
    </div>
  </div>
}
