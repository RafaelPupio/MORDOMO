import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ChurchChatBox V2</h1>
      <p className="text-sm text-neutral-600">
        An AI church secretary — RAG, agents, and automation in one product. Demo of a
        fictional Brazilian church.
      </p>
      <Link href="/chat" className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white">
        Talk to the secretary →
      </Link>
    </main>
  );
}
