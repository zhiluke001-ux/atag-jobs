import type { Metadata } from 'next';
import { AuthProvider } from '@/components/Auth';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'ATAG Jobs',
  description: 'Event staffing, QR attendance, wage calc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{margin:0,fontFamily:'Inter, system-ui, Arial'}}>
        <AuthProvider>
          <Nav />
          <main style={{maxWidth:1100, margin:'10px auto', padding:'0 16px'}}>
            {children}
          </main>
        </AuthProvider>
        <style jsx global>{`
          :root{--border:#e5e5e5}
          .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
          .cards .card{border:1px solid var(--border);border-radius:12px;padding:16px;background:#fff}
          .card{border:1px solid var(--border);border-radius:12px;padding:16px;background:#fff}
          .row{display:flex;gap:8px;flex-wrap:wrap}
          .kv{color:#666;font-size:14px}
          .hint{color:#777}
        `}</style>
      </body>
    </html>
  );
}
