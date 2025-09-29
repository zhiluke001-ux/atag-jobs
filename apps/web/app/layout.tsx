import './globals.css';
import Nav from '../components/Nav';
import { AuthProvider } from '../components/Auth';

export const metadata = { title: 'ATAG Jobs', description: 'Jobs & QR Attendance' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body>
        <AuthProvider>
          <Nav />
          <div className="hero"><div className="container"><h1>ATAG Jobs & Attendance</h1><p>Hire, approve, and track event part-timers with secure QR attendance.</p></div></div>
          <main className="container">{children}</main>
          <footer className="footer">
            <div className="container cols">
              <div><div style={{fontWeight:700,marginBottom:6}}>ATAG Jobs & Attendance</div><div className="kv">Streamlined workforce management for events</div><div className="kv" style={{marginTop:12}}>© {new Date().getFullYear()} ATAG</div></div>
              <div><h4>Features</h4><div className="kv">Dashboard</div><div className="kv">Job Management</div><div className="kv">Attendance</div><div className="kv">Wage Calculation</div></div>
              <div><h4>Support</h4><div className="kv">Contact</div><div className="kv">Help Center</div><div className="kv">Privacy</div></div>
              <div />
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
