 import React, { useState } from "react";
 import { login } from "../auth";

 export default function Login({ navigate, setUser }) {
   const [email, setEmail] = useState("");
   const [error, setError] = useState(null);

   async function onSubmit(e) {
     e.preventDefault();
     try {
       const u = await login(email);
       setUser(u);
-      navigate("#/dashboard");
       navigate("#/"); // go to Home after login
     } catch (e) {
       setError("Login failed. Try alice@example.com, pm@example.com, or admin@example.com");
     }
   }

   return (
     <div className="container">
       <form className="card" onSubmit={onSubmit}>
         <div style={{fontWeight:700, fontSize:18, marginBottom:8}}>Log in</div>
         <div>Email</div>
         <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={{width:"100%", marginTop:6}} />
         {error && <div style={{color:"crimson", marginTop:8}}>{error}</div>}
         {/* Quick examples */}
        <div style={{marginTop:10, fontSize:12, opacity:.8}}>
          <div>Examples:</div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:6}}>
            {["alice@example.com","pm@example.com","admin@example.com"].map(x=>(
              <button
                key={x}
                type="button"
                 className="btn"
                 onClick={()=>setEmail(x)}
               >{x}</button>
             ))}
           </div>
         </div>
         <div style={{marginTop:10}}>
           <button className="btn primary" type="submit">Log in</button>
         </div>
       </form>
     </div>
   );
 }
