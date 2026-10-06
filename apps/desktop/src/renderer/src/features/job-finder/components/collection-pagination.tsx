import { useLayoutEffect, useRef } from "react";
import { Button } from "@renderer/components/ui/button";

export const COLLECTION_PAGE_SIZE = 40;
export const APPLICATION_CRM_PAGE_SIZE = 50;

interface CollectionPaginationProps {
  itemLabel: string;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

/**
 * Keeps large local collections cheap to mount without changing their search
 * or selection semantics. The list itself remains the scroll container; this
 * footer is outside it so it cannot cover the last row.
 */
export function CollectionPagination({
  itemLabel,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: CollectionPaginationProps) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalCount);
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"previous" | "next" | null>(null);

  useLayoutEffect(() => {
    const focusDirection = pendingFocusRef.current;
    if (!focusDirection) {
      return;
    }
    pendingFocusRef.current = null;

    const primaryTarget =
      focusDirection === "next"
        ? nextButtonRef.current
        : previousButtonRef.current;
    const fallbackTarget =
      focusDirection === "next"
        ? previousButtonRef.current
        : nextButtonRef.current;
    const target =
      primaryTarget && !primaryTarget.disabled
        ? primaryTarget
        : fallbackTarget && !fallbackTarget.disabled
          ? fallbackTarget
          : null;
    target?.focus();
  }, [currentPage]);

  const handlePageChange = (
    nextPage: number,
    focusDirection: "previous" | "next",
  ) => {
    pendingFocusRef.current = focusDirection;
    onPageChange(nextPage);
  };

  if (pageCount <= 1) {
    return null;
  }

  return (
    // One line: "1–40 of 353" on the left, the page buttons on the right.
    <nav
      aria-label={`${itemLabel} pagination`}
      className="flex h-11 flex-none items-center justify-between gap-3 border-t border-(--surface-panel-border) px-3"
      data-collection-pagination
    >
      <p
        aria-live="polite"
        className="min-w-0 truncate text-(length:--text-small) tabular-nums text-foreground-muted"
      >
        {firstItem}–{lastItem} of {totalCount}
        <span className="sr-only"> {itemLabel}</span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          aria-label="Previous page"
          disabled={currentPage === 1}
          onClick={() => handlePageChange(currentPage - 1, "previous")}
          ref={previousButtonRef}
          size="xs"
          type="button"
          variant="ghost"
        >
          Previous
        </Button>
        <span
          aria-current="page"
          className="min-w-16 text-center text-(length:--text-small) tabular-nums text-foreground-soft"
        >
          Page {currentPage} of {pageCount}
        </span>
        <Button
          aria-label="Next page"
          disabled={currentPage === pageCount}
          onClick={() => handlePageChange(currentPage + 1, "next")}
          ref={nextButtonRef}
          size="xs"
          type="button"
          variant="ghost"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
