export function ComingLaterCard({
  title,
  message = "Coming in a later phase.",
}: {
  title: string;
  message?: string;
}) {
  return (
    <div className="card coming-later">
      <strong>{title}</strong>
      <p className="muted">{message}</p>
    </div>
  );
}
