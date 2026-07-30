export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Flowent">
      <span className="brand-symbol" aria-hidden="true">
        <span />
        <span />
      </span>
      {compact ? null : <span className="brand-word">Flowent</span>}
    </div>
  );
}
