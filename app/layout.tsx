import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://smartx-service-catalog.bjplc2009.chatgpt.site'),
  title: '服务目录｜SmartX 服务管理中心',
  description: '统一维护专业服务目录、计价规则与交付约束的管理后台。',
  openGraph: {
    title: '服务目录｜SmartX 服务管理中心',
    description: '统一维护专业服务目录、计价规则与交付约束的管理后台。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '服务目录｜SmartX 服务管理中心' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '服务目录｜SmartX 服务管理中心',
    description: '统一维护专业服务目录、计价规则与交付约束的管理后台。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
