import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { hangUp, restoreActiveCall, toggleMicrophone } from "../services/call-manager"

/** Lecteur persistant : garde les sorties audio/video WebRTC quand CallRoom est démonté. */
export function ActiveCallFloating() {
  const call=useCallState(), nav=useNavigate()
  const [controls,setControls]=useState(false), [pos,setPos]=useState({x:0,y:0})
  const drag=useRef({x:0,y:0,ox:0,oy:0,on:false})
  const remoteEntries=Object.entries(call.remoteStreams), remote=remoteEntries[0]?.[1]
  if(!call.activeCallId || call.displayMode!=="compact") return null
  const videoCall=call.callType==="video", mobile=typeof window!=="undefined"&&window.matchMedia("(max-width: 900px)").matches
  const restore=()=>{ const id=call.activeCallId; restoreActiveCall(); requestAnimationFrame(()=>nav(`/calls/${id}?type=${call.callType}`,{replace:true})) }
  return <div className="active-call-floating" style={mobile?{transform:`translate(${pos.x}px,${pos.y}px)`}:undefined} onPointerDown={e=>{if(!mobile)return;drag.current={x:e.clientX,y:e.clientY,ox:pos.x,oy:pos.y,on:true};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(!mobile)return;const d=drag.current;if(d.on)setPos({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y})}} onPointerUp={()=>drag.current.on=false}>
    {remoteEntries.map(([id,stream])=><audio key={id} autoPlay ref={el=>{if(!el)return;if(el.srcObject!==stream){el.srcObject=stream;void el.play().catch(()=>undefined)}el.muted=!call.speakerOn}}/>) }
    <div className="active-call-content" onClick={()=>setControls(v=>!v)}>
      {videoCall&&remote?<video ref={el=>{if(el&&remote){el.srcObject=remote;void el.play().catch(()=>undefined)}}} autoPlay playsInline muted/>:<div className="active-call-audio"><b>{call.peerName||"Appel"}</b><span>Appel en cours</span></div>}
      {controls&&<div className="active-call-controls" onPointerDown={e=>e.stopPropagation()}><button onClick={e=>{e.stopPropagation();restore()}}>Retour appel</button><button onClick={()=>toggleMicrophone()}>{call.micOn?"Muet":"Micro"}</button><button className="end" onClick={()=>void hangUp()}>Raccrocher</button></div>}
    </div>
  </div>
}
