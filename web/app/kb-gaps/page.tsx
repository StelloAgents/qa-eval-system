import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { KbGapsView } from "@/components/kb-gaps-view";

export default function KbGapsPage() {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <Suspense>
          <KbGapsView />
        </Suspense>
      </main>
    </>
  );
}
