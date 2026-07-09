export function BrandMark({
  companyName,
  logoUrl,
  size = 32,
  textClassName = "font-semibold text-text tracking-tight",
  showName = true,
}: {
  companyName: string;
  logoUrl: string | null;
  size?: number;
  textClassName?: string;
  showName?: boolean;
}) {
  const letter = (companyName.trim()[0] ?? "S").toUpperCase();
  return (
    <span className="flex items-center gap-2 min-w-0">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={companyName} width={size} height={size}
          className="rounded-lg object-contain shrink-0" style={{ width: size, height: size }} />
      ) : (
        <span className="rounded-lg bg-accent grid place-items-center text-white font-bold shrink-0"
          style={{ width: size, height: size, fontSize: size * 0.45 }}>{letter}</span>
      )}
      {showName && <span className={"truncate " + textClassName}>{companyName}</span>}
    </span>
  );
}
