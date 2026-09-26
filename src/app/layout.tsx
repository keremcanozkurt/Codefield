import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "Understand a local codebase visually.";

export const metadata: Metadata = {
  title: "Codefield",
  description,
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
