import { Navigate, createHashRouter } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import {
  JobFinderActionsRoute,
  JobFinderAnalyticsRoute,
  JobFinderApplicationsRoute,
  JobFinderCompaniesRoute,
  JobFinderCompanyDetailRoute,
  JobFinderDiscoveryRoute,
  JobFinderPage,
  JobFinderProfileRoute,
  JobFinderProfileSetupRoute,
  JobFinderResumeStrategiesRoute,
  JobFinderRouteErrorBoundary,
  JobFinderResumeWorkspaceRoute,
  JobFinderReviewQueueRoute,
  JobFinderSafeguardsRoute,
  JobFinderSettingsRoute,
} from "../pages/job-finder-page";
import {
  JobFinderCampaignsRoute,
  JobFinderHomeRoute,
  JobFinderRapidReviewRoute,
} from "../pages/job-finder-page-routes";

const loadInterviewHelperRoutes = () =>
  import("../features/interview-helper/interview-helper-page");
const InterviewHelperPage = lazy(async () => ({
  default: (await loadInterviewHelperRoutes()).InterviewHelperPage,
}));
const InterviewAnswerOverlayRoute = lazy(async () => ({
  default: (await loadInterviewHelperRoutes()).InterviewAnswerOverlayRoute,
}));
const InterviewTranscriptOverlayRoute = lazy(async () => ({
  default: (await loadInterviewHelperRoutes()).InterviewTranscriptOverlayRoute,
}));

function InterviewRouteFallback() {
  return (
    <main className="grid min-h-full place-items-center bg-canvas px-6 py-10">
      <div role="status">
        <h1>Loading Interview Helper</h1>
        <p>Opening your interview workspace.</p>
      </div>
    </main>
  );
}

function withInterviewFallback(element: ReactNode) {
  return <Suspense fallback={<InterviewRouteFallback />}>{element}</Suspense>;
}

export const appRouter = createHashRouter([
  {
    path: "/",
    element: <Navigate replace to="/job-finder" />,
  },
  {
    path: "/interview-helper",
    element: withInterviewFallback(<InterviewHelperPage />),
  },
  {
    path: "/interview-helper/overlay/answer",
    element: withInterviewFallback(<InterviewAnswerOverlayRoute />),
  },
  {
    path: "/interview-helper/overlay/transcript",
    element: withInterviewFallback(<InterviewTranscriptOverlayRoute />),
  },
  {
    path: "/job-finder",
    errorElement: <JobFinderRouteErrorBoundary scope="app" />,
    element: <JobFinderPage />,
    children: [
      {
        index: true,
        element: <Navigate replace to="home" />,
      },
      {
        path: "home",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderHomeRoute />,
      },
      {
        path: "campaigns",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderCampaignsRoute />,
      },
      {
        path: "profile",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderProfileRoute />,
      },
      {
        path: "profile/setup",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderProfileSetupRoute />,
      },
      {
        path: "discovery",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderDiscoveryRoute />,
      },
      {
        path: "rapid-review",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderRapidReviewRoute />,
      },
      {
        path: "review-queue",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderReviewQueueRoute />,
      },
      {
        path: "review-queue/:jobId/resume",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderResumeWorkspaceRoute />,
      },
      {
        path: "actions",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderActionsRoute />,
      },
      {
        path: "analytics",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderAnalyticsRoute />,
      },
      {
        path: "applications",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderApplicationsRoute />,
      },
      {
        // The former Documents destination. Its files live under Profile ›
        // Files now; old links and saved routes land there.
        path: "documents",
        element: <Navigate replace to="/job-finder/profile?section=files" />,
      },
      {
        path: "settings",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderSettingsRoute />,
      },
      {
        path: "resume-strategies",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderResumeStrategiesRoute />,
      },
      {
        path: "safeguards",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderSafeguardsRoute />,
      },
      {
        path: "companies",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderCompaniesRoute />,
      },
      {
        path: "companies/:companyId",
        errorElement: <JobFinderRouteErrorBoundary scope="route" />,
        element: <JobFinderCompanyDetailRoute />,
      },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to="/job-finder" />,
  },
]);
