import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";

const fontVariables = {
  "--font-space-grotesk":
    '"Space Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--font-ibm-plex-mono":
    '"IBM Plex Mono", "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
} as CSSProperties;

export const metadata: Metadata = {
  title: "PaperGraph",
  description: "Artigos LaTeX ligados por ideias.",
  icons: {
    icon: "/papergraph-icon.png",
    shortcut: "/papergraph-icon.png",
    apple: "/papergraph-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-PT" className="h-full antialiased" style={fontVariables}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
