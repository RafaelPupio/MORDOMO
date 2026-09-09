import Link from 'next/link';

// A branded 404 instead of Next's bare default — the public site has visitors who mistype,
// and the staff area has bookmarks that outlive a rename.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center">
        <p className="font-mono text-xs tracking-[0.16em] text-neutral-500 uppercase">MORDOMO</p>
        <h1 className="text-base font-semibold">Página não encontrada · Page not found</h1>
        <p className="text-sm text-neutral-600">
          O endereço não existe ou mudou. · This address does not exist or has moved.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-sm">
          <Link href="/" className="rounded-xl bg-neutral-900 px-4 py-2 font-medium text-white">Início · Home</Link>
          <Link href="/chat" className="rounded-xl border px-4 py-2 font-medium">Falar com a secretária · Chat</Link>
        </div>
      </div>
    </main>
  );
}
