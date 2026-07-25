import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Dashboard } from "@/components/dashboard";

export default function DashboardPage() {
  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <main>
        <Suspense>
          <Dashboard />
        </Suspense>
      </main>
    </>
  );
}
