'use client';
import { useAuth } from '../../components/Auth';

export default function PMHome(){
  const { user } = useAuth();
  if(!user || user.role!=='PM') return <section className="card"><h2>PM</h2><div className="kv">Restricted.</div></section>;
  return (
    <section className="card">
      <h2>Welcome PM {user.name}</h2>
      <p className="kv">Create & manage jobs, approve applicants, scan attendance, and view reports.</p>
      <div className="row" style={{marginTop:10}}>
        <a className="btn primary" href="/pm/jobs">Open Jobs</a>
        <a className="btn" href="/pm/scan">Open Scanner</a>
        <a className="btn" href="/pm/reports">Reports</a>
      </div>
    </section>
  );
}
