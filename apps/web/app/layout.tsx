import type { Metadata } from 'next';
import { AuthProvider } from '@/components/Auth';
import Nav from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATAG Jobs',
  description: 'Event staffing, QR attendance, wage calc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <main style={{ maxWidth: 1100, margin: '10px auto', padding: '0 16px' }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
