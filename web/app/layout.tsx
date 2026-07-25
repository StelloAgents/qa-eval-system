import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "KB Regression Testing",
  description: "Regression testing for multi-org AI customer service agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background bg-grid">
        <div className="bg-glow min-h-screen">{children}</div>
        <Toaster theme="dark" richColors position="bottom-right" />
      </body>
    </html>
  );
}
