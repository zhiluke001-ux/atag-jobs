export default function Home() {
  return (
    <section className="card" style={{maxWidth:860,margin:'0 auto'}}>
      <h2>ATAG Jobs</h2>
      <p className="kv">Lightweight event staffing with PM dashboards, QR attendance, and wage calc. Log in to get started.</p>
      <div className="row" style={{marginTop:10}}>
        <a className="btn primary" href="/available">Browse Jobs</a>
        <a className="btn" href="/login">Log In</a>
      </div>
    </section>
  );
}
