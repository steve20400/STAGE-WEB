import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { hangUp, restoreActiveCall, toggleMicrophone } from "../services/call-manager"

/** Lecteur persistant : garde les sorties audio/video WebRTC quand CallRoom est démonté. */
export function ActiveCallFloating() {
  const call=useCallState(), nav=useNavigate(), video=useRef<HTMLVideoElement>(null), localVideo=useRef<HTMLVideoElement>(null)
  const [controls,setControls]=useState(false), [pos,setPos]=useState({x:0,y:0}), [pip,setPip]=useState({x:0,y:0})
  const pipDrag=useRef({x:0,y:0,ox:0,oy:0,on:false}), drag=useRef({x:0,y:0,ox:0,oy:0,on:false})
  const remoteEntries=Object.entries(call.remoteStreams), remote=remoteEntries[0]?.[1]
  useEffect(()=>{if(video.current&&remote){video.current.srcObject=remote; void video.current.play().catch(()=>undefined)}},[remote])
  useEffect(()=>{if(localVideo.current&&call.localStream)localVideo.current.srcObject=call.localStream},[call.localStream])
  if(!call.activeCallId || call.displayMode!=="compact") return null
  const videoCall=call.callType==="video", mobile=typeof window!=="undefined"&&window.matchMedia("(max-width: 900px)").matches
  const restore=()=>{restoreActiveCall();nav(`/calls/${call.activeCallId}?type=${call.callType}`)}
  return <div className="active-call-floating" style={mobile?{transform:`translate(${pos.x}px,${pos.y}px)`}:undefined} onPointerDown={e=>{if(!mobile)return;drag.current={x:e.clientX,y:e.clientY,ox:pos.x,oy:pos.y,on:true};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(!mobile)return;const d=drag.current;if(d.on)setPos({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y})}} onPointerUp={()=>drag.current.on=false}>
    {remoteEntries.map(([id,stream])=><audio key={id} autoPlay ref={el=>{if(el&&el.srcObject!==stream){el.srcObject=stream;void el.play().catch(()=>undefined)}}}/>) }
    <div className="active-call-content" onClick={()=>setControls(v=>!v)}>
      {videoCall&&remote?<><video ref={video} autoPlay playsInline/>{call.localStream&&call.camOn&&<video className="active-call-local-pip" style={{transform:`translate(${pip.x}px,${pip.y}px) scaleX(-1)`}} onPointerDown={e=>{const d=pipDrag.current;d.x=e.clientX;d.y=e.clientY;d.ox=pip.x;d.oy=pip.y;d.on=true;e.stopPropagation()}} onPointerMove={e=>{const d=pipDrag.current;if(d.on)setPip({x:d.ox+e.clientX-d.x,y:d.oy+e.clientY-d.y})}} onPointerUp={()=>pipDrag.current.on=false} ref={localVideo} autoPlay playsInline muted/>}</>:<div className="active-call-audio"><b>{call.peerName||"Appel"}</b><span>Appel en cours</span></div>}
      {controls&&<div className="active-call-controls" onPointerDown={e=>e.stopPropagation()}><button onClick={restore}>Retour appel</button><button onClick={()=>toggleMicrophone()}>{call.micOn?"Muet":"Micro"}</button><button className="end" onClick={()=>void hangUp()}>Raccrocher</button></div>}
    </div>
  </div>
}
