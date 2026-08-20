// Placeholder dashboard home. The guard in `(dashboard)/layout.tsx` already ensures a valid
// staff session exists before this renders. Task 5 replaces this with the real overview.
export default function StaffHome() {
  return (
    <div>
      <h2 className="text-base font-semibold">Início</h2>
      <p className="mt-2 text-sm text-neutral-600">
        Painel da secretaria em construção.
      </p>
    </div>
  );
}
