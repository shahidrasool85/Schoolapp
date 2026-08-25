import type { FormEvent, ReactNode } from "react";

export function FilterBar({
  children,
  actions,
  onSubmit,
}: {
  children: ReactNode;
  actions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="filter-bar" onSubmit={onSubmit}>
      {children}
      {actions ? <div className="filter-actions">{actions}</div> : null}
    </form>
  );
}

export function SearchInput({
  id = "search",
  label = "Search",
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-input" htmlFor={id}>
      {label}
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export function DataTable({
  headers,
  children,
}: {
  headers: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{headers}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tabs({ children }: { children: ReactNode }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {children}
    </nav>
  );
}
