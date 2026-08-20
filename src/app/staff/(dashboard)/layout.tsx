import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readStaffSession } from '@/core/staff-auth';
import { STAFF_COOKIE_NAME } from '@/core/staff-session';
import { signOut } from '../login/actions';

export const metadata = { title: 'Secretaria — Igreja da Colina (demo)' };

const NAV = [
  { href: '/staff', label: 'Início' },
  { href: '/staff/documentos', label: 'Documentos' },
  { href: '/staff/agenda', label: 'Agenda' },
  { href: '/staff/oracoes', label: 'Orações' },
  { href: '/staff/atendimentos', label: 'Atendimentos' },
  { href: '/staff/uso', label: 'Uso' },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // The login route lives outside this route group and renders its own page;
  // everything inside this group requires a valid session.
  const cookieStore = await cookies();
  const session = readStaffSession(
    cookieStore.get(STAFF_COOKIE_NAME)?.value,
    process.env.STAFF_SESSION_SECRET,
  );
  if (!session) redirect('/staff/login');

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-lg font-semibold">Secretaria — Igreja da Colina</h1>
          <p className="text-xs text-neutral-500">Igreja fictícia — demonstração</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-neutral-600 underline">Sair</button>
        </form>
      </header>
      <nav className="flex flex-wrap gap-3 border-b py-2 text-sm">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="text-emerald-800 hover:underline">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 py-4">{children}</div>
    </div>
  );
}
