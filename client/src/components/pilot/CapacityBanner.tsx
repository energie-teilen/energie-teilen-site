export function CapacityBanner({ remaining }: { remaining: number }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
      <strong>{remaining} pilot onboarding slots</strong> remain for this month. New paid projects start in order of completed checkout.
    </div>
  );
}
