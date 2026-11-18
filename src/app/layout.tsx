import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: {
    default: "سامانه پشتیبانی سازمان",
    template: "%s | سامانه پشتیبانی سازمان",
  },
  description:
    "میز پشتیبانی هوشمند و مرکز اشتراک فایل سازمانی — پاسخگویی مبتنی بر دانش سازمانی، گفتگوی زنده و مدیریت درخواست‌ها.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
