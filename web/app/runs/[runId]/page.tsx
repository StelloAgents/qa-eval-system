import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ResultsView } from "@/components/results-view";

export default function RunResultsPage({
  params,
  searchParams,
}: {
  params: { runId: string };
  searchParams: { org?: string };
}) {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <ResultsView runId={params.runId} orgId={searchParams.org ?? "texans"} />
      </main>
    </>
  );
}
