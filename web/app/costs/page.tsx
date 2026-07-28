import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CostsView } from "@/components/costs-view";

export default function CostsPage() {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <Suspense>
          <CostsView />
        </Suspense>
      </main>
    </>
  );
}
