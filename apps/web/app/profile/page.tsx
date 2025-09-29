'use client';
import { useAuth } from '../../components/Auth';

export default function Profile(){
  const { user } = useAuth();
  if(!user) return <section className="card"><h2>Profile</h2><div className="kv">Please log in.</div></section>;
  return (
    <section className="card" style={{maxWidth:720}}>
      <h2>Profile</h2>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap:12, marginTop:8}}>
        <div className="card"><div className="kv">Name</div><div style={{fontWeight:600}}>{user.name}</div></div>
        <div className="card"><div className="kv">Email</div><div style={{fontWeight:600}}>{user.email}</div></div>
      </div>
      <div className="kv" style={{marginTop:12}}>Role: <b>{user.role}</b></div>
    </section>
  );
}
