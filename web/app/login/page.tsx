import { Suspense } from "react";
import { ALLOWED_DOMAIN } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

// The domain is read on the server and passed down, so the client bundle does
// not depend on a NEXT_PUBLIC_ copy of it existing.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm allowedDomain={ALLOWED_DOMAIN} />
    </Suspense>
  );
}
