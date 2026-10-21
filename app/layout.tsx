import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日有所成 · 登录与云端记录",
  description: "记录每天完成的事，登录后在手机与电脑间回顾自己的进步。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
