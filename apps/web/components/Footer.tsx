export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="grid">
          <div className="card" style={{gridColumn:'span 4'}}>
            <h4>ATAG Jobs & Attendance</h4>
            <p className="kv">Streamlined workforce management for events</p>
            <p className="kv">© 2025 ATAG</p>
          </div>
          <div className="card" style={{gridColumn:'span 4'}}>
            <h4>Features</h4>
            <ul>
              <li><a href="/dashboard">Dashboard</a></li>
              <li><a href="/pm/jobs">Job Management</a></li>
              <li><a href="/attendance">Attendance</a></li>
              <li><a href="/payments">Wage Calculation</a></li>
            </ul>
          </div>
          <div className="card" style={{gridColumn:'span 4'}}>
            <h4>Support</h4>
            <ul>
              <li><a href="/contact">Contact</a></li>
              <li><a href="/help">Help Center</a></li>
              <li><a href="/privacy">Privacy</a></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
