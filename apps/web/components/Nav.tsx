'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './Auth';

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const is = (p: string) => pathname === p;

  const can = {
    jobsPublic: true, // show “Jobs” to logged-out users too
    dashboard: !!user,
    available: true,
    myjobs: user?.role === 'PART_TIMER',
    payments: user?.role === 'PART_TIMER',
    pm: user?.role === 'PM',
    admin: user?.role === 'ADMIN',
  };

  async function onLogout() {
    await logout();
    router.replace('/'); // smooth redirect without showing flicker
  }

  return (
    <div className="nav container">
      <div className="brand">
        <div className="logo">AT</div>
        <Link href="/" style={{ fontWeight: 800 }}>
          ATAG Jobs
        </Link>
      </div>
      <nav className="navlinks">
        {can.dashboard && (
          <Link className={is('/dashboard') ? 'active' : ''} href="/dashboard">
            Dashboard
          </Link>
        )}
        {can.jobsPublic && (
          <Link className={is('/available') ? 'active' : ''} href="/available">
            Jobs
          </Link>
        )}
        {can.myjobs && (
          <Link className={is('/my-jobs') ? 'active' : ''} href="/my-jobs">
            My Jobs
          </Link>
        )}
        {can.payments && (
          <Link className={is('/payments') ? 'active' : ''} href="/payments">
            Payments
          </Link>
        )}
        {can.pm && (
          <Link className={is('/pm') ? 'active' : ''} href="/pm">
            PM
          </Link>
        )}
        {can.admin && (
          <Link className={is('/admin') ? 'active' : ''} href="/admin">
            Admin
          </Link>
        )}
        {!loading && !user && (
          <Link href="/login" className="btn grey">
            Log In
          </Link>
        )}
        {!loading && user && (
          <>
            <span className="badge">{user.name} · {user.role}</span>
            <button className="btn" onClick={onLogout}>Log Out</button>
          </>
        )}
      </nav>
    </div>
  );
}
