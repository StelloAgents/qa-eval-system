import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { HistoryView } from "@/components/history-view";

export default function HistoryPage() {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <Suspense>
          <HistoryView />
        </Suspense>
      </main>
    </>
  );
}
