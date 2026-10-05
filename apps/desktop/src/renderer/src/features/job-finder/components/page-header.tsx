import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@renderer/lib/cn";

import { PageStatusLine, type PageStatusItem } from "./page-status-line";

interface PageHeaderProps {
  /**
   * Page-level actions on the right of the title row: `size="sm"` buttons,
   * at most two.
   */
  actions?: ReactNode;
  /**
   * One sentence of 90 characters or fewer about what the page is for. It
   * stays on one line and truncates; the full text is its tooltip and the
   * heading's accessible description. Instructions belong where they apply.
   */
  description: string;
  title: string;
}

/**
 * One row: the title, a one-line description beside it, and the page actions
 * on the right. Below 1024px the description drops under the title, still on
 * one line.
 */
export function PageHeader({ actions, description, title }: PageHeaderProps) {
  const descriptionId = useId();

  return (
    <header
      className="flex min-h-8 min-w-0 items-center justify-between gap-4"
      data-page-header
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-baseline lg:gap-3">
        <h1
          aria-describedby={descriptionId}
          className="shrink-0 font-display text-(length:--text-page-title-compact) font-semibold leading-none tracking-(--tracking-page-title-compact) text-(--headline-primary)"
        >
          {title}
        </h1>
        <p
          className="min-w-0 truncate text-(length:--text-page-description-compact) leading-5 text-foreground-soft"
          id={descriptionId}
          title={description}
        >
          {description}
        </p>
      </div>
      {actions ? (
        <div
          className="flex shrink-0 items-center gap-2"
          data-page-header-actions
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function PageHeaderStack(
  props: PageHeaderProps & {
    /**
     * Toned items for the status line under the title (ADR 0044). The line
     * is not rendered when the list is empty.
     */
    statusItems?: readonly PageStatusItem[];
    subnav?: ReactNode;
  },
) {
  const { statusItems, subnav, ...headerProps } = props;

  return (
    <div className="mb-(--gap-page-header-body)" data-page-header-stack>
      <PageHeader {...headerProps} />
      {statusItems && statusItems.length > 0 ? (
        <PageStatusLine items={statusItems} />
      ) : null}
      {subnav ? (
        <div className="mt-(--gap-page-header-aux)" data-page-header-subnav>
          {subnav}
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className="mt-(--gap-page-header-aux) border-b border-(--surface-panel-border)"
        data-page-header-divider
      />
    </div>
  );
}

export function PageSubnav({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}
      data-page-subnav
      {...props}
    />
  );
}

export type { PageStatusAction, PageStatusItem } from "./page-status-line";
