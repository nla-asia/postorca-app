export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`mark ${className}`}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M24 3v42M3 24h42M9.15 9.15l29.7 29.7m-29.7 0 29.7-29.7"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <circle cx="24" cy="24" r="5.5" fill="currentColor" />
    </svg>
  );
}
