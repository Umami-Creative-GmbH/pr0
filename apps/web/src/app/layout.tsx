import { ApiProvider } from "@pr0/api-client/provider";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "pr0",
  description: "pr0 web application",
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body className="min-h-screen antialiased">
      <ApiProvider>{children}</ApiProvider>
    </body>
  </html>
);

export default RootLayout;
