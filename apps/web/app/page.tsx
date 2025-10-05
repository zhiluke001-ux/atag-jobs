export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>ATAG Jobs & Attendance</h1>
          <p>Hire, approve, and track event part-timers with secure QR attendance.</p>
        </div>
      </section>

      {/* Overlapping welcome card, perfectly centered by the container */}
      <section className="home-lead">
        <div className="container">
          <div className="card elevated center-card">
            <h2>Welcome to ATAG Jobs</h2>
            <p className="kv">
              Hire, approve, and track event part-timers with secure, single-use QR attendance.
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn primary" href="/available">Browse Jobs</a>
              <a className="btn" href="/login">Log In</a>
            </div>
          </div>
        </
