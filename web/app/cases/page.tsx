import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CasesView } from "@/components/cases-view";

export default function CasesPage() {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <Suspense>
          <CasesView />
        </Suspense>
      </main>
    </>
  );
}
