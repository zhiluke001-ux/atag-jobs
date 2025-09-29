'use client';
import { useAuth } from '../../components/Auth';

export default function AdminHome(){
  const { user } = useAuth();
  if(!user || user.role!=='ADMIN') return <section className="card"><h2>Admin</h2><div className="kv">Restricted.</div></section>;
  return (
    <section className="card">
      <h2>Welcome, Admin {user.name}</h2>
      <div className="row" style={{marginTop:10}}>
        <a className="btn primary" href="/admin/jobs">Jobs Management</a>
        <a className="btn" href="/admin/attendance">Attendance Records</a>
      </div>
    </section>
  );
}
