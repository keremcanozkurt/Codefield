import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "Turn a public GitHub repository into an interactive map of its code.";

export const metadata: Metadata = {
  title: "Codefield",
  description,
  openGraph: {
    title: "Codefield",
    description,
    type: "website",
    siteName: "Codefield",
  },
  twitter: {
    card: "summary",
    title: "Codefield",
    description,
  },
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
