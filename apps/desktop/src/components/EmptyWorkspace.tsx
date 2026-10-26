import type { NavigationItem } from "../navigation";
export default function EmptyWorkspace({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <div className="page-content">
      <section className="empty-state" aria-labelledby="page-title">
        <span className="empty-icon">
          <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 id="page-title">{item.name}</h1>
        <p>{item.description}</p>
        <span className="placeholder-label">Coming soon</span>
      </section>
    </div>
  );
}
