import { Button } from "@renderer/components/ui/button";
import { EmptyState } from "../../components/empty-state";
import { Link } from "react-router-dom";
import { JOB_FINDER_ROUTE_PATHS } from "../../lib/job-finder-route-hrefs";
import {
  APPLICATION_FILTER_LABELS,
  type ApplicationsViewFilter,
} from "./applications-filters";

export function ApplicationsDetailPanelEmptyState(props: {
  activeFilter: ApplicationsViewFilter;
  hasAnyApplications: boolean;
  hasVisibleApplications: boolean;
}) {
  const { activeFilter, hasAnyApplications, hasVisibleApplications } = props;

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center pt-12">
      {!hasAnyApplications ? (
        <div className="grid max-w-96 gap-3 justify-items-center text-center">
          <p className="text-(length:--text-description) leading-6 text-foreground-soft break-words [overflow-wrap:anywhere]">
            Details appear here after you select a job in Shortlisted and choose
            Apply. Job Finder uses your resume and the apply mode chosen in
            Settings.
          </p>
          <Button asChild size="sm" type="button" variant="primary">
            <Link to={JOB_FINDER_ROUTE_PATHS.reviewQueue}>
              Open Shortlisted
            </Link>
          </Button>
        </div>
      ) : (
        <EmptyState
          title={
            hasVisibleApplications
              ? "Choose an application"
              : "No applications in this view"
          }
          description={
            hasVisibleApplications
              ? "Select an application to review its stage, latest apply attempt, and timeline."
              : `Try another filter if you want to review applications outside the ${APPLICATION_FILTER_LABELS[activeFilter]} view.`
          }
        />
      )}
    </div>
  );
}
