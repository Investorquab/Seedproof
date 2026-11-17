type Props = { size?: number; variant?: "pocket" | "home" };

/** Two halves of one key: slate is the Pocket, brass is the Home Key. */
export function Logo({ size = 34, variant = "pocket" }: Props) {
  const [left, right] = variant === "home" ? ["#C9B27C", "#3F2E0B"] : ["#1C2530", "#B5862F"];
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <rect x="1" y="1" width="15" height="32" rx="7.5" fill={left} />
      <rect x="18" y="1" width="15" height="32" rx="7.5" fill={right} />
      {variant === "pocket" && (
        <>
          <circle cx="8.5" cy="9" r="3" fill="#E9ECEF" />
          <circle cx="25.5" cy="9" r="3" fill="#E9ECEF" />
        </>
      )}
    </svg>
  );
}
