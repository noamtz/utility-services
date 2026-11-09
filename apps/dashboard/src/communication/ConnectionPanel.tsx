import { useState } from "react";
import type { CommunicationConnection } from "@utility-services/contracts";
import { type createCommunicationApi } from "./api.js";
type Api=ReturnType<typeof createCommunicationApi>;
export function ConnectionPanel({projectId,api}:{projectId:string;api:Api}){
 const [connection,setConnection]=useState<CommunicationConnection>(); const [instanceId,setInstanceId]=useState(""); const [credential,setCredential]=useState(""); const [error,setError]=useState<string>();
 async function register(){try{const value=await api.register(projectId,{provider:"green-api",instanceId,credential});setConnection(value);setCredential("");setError(undefined)}catch{setError("Connection could not be saved.")}}
 async function disable(){if(!connection)return;try{setConnection(await api.disable(projectId,connection.connectionId))}catch{setError("Connection could not be disabled.")}}
 return <section className="panel" aria-label="Communication connection"><h2>Communication</h2>{connection?<><p>GREEN instance: {connection.instanceId}</p><p>Status: {connection.status}</p><button onClick={()=>void disable()} disabled={connection.status==="disabled"}>Disable connection</button></>:<><label>Instance ID<input value={instanceId} onChange={e=>setInstanceId(e.target.value)}/></label><label>Credential<input type="password" value={credential} onChange={e=>setCredential(e.target.value)}/></label><button onClick={()=>void register()}>Connect GREEN</button></>}{error&&<p role="alert">{error}</p>}</section>
}
