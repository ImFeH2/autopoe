import { Badge } from "@/components/ui";

type PageHeaderProps = {
  count?: number;
  title: string;
};

export function PageHeader({ count, title }: PageHeaderProps) {
  return (
    <header className="page-heading border-border border-b">
      <h2 className="page-title m-0 font-semibold">{title}</h2>
      {count !== undefined ? <Badge>{count}</Badge> : null}
    </header>
  );
}
