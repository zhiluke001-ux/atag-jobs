'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './Auth';

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const is = (p: string) => pathname === p;
  const jobsHref = () => (user?.role === 'PM' || user?.role === 'ADMIN') ? '/pm/jobs' : '/available';

  async function onLogout(){ await logout(); router.replace('/'); }

  return (
    <div className="nav container">
      <div className="brand"><div className="logo">AT</div><Link href="/" style={{fontWeight:800}}>ATAG Jobs</Link></div>
      <nav className="navlinks">
        {user && <Link className={is('/dashboard')?'active':''} href="/dashboard">Dashboard</Link>}
        <Link className={is('/available')||is('/pm/jobs')?'active':''} href={jobsHref()}>Jobs</Link>
        {user?.role==='PART_TIMER' && <Link className={is('/my-jobs')?'active':''} href="/my-jobs">My Jobs</Link>}
        {user?.role==='PART_TIMER' && <Link className={is('/payments')?'active':''} href="/payments">Payments</Link>}
        {!loading && !user && <Link href="/login" className="btn grey">Log In</Link>}
        {!loading && user && (<><span className="badge">{user.name} · {user.role}</span><button className="btn" onClick={onLogout}>Log Out</button></>)}
      </nav>
    </div>
  );
}
