import type { Metadata } from 'next';
import './globals.css';
import { DemoAssistant } from '@/components/demo-assistant';

export const metadata: Metadata = {
  metadataBase: new URL(
    'https://smartx-service-catalog.bjplc2009.chatgpt.site',
  ),
  title: 'SmartX 服务管理中心',
  description: '管理服务请求、服务目录与业务引用数据的统一工作台。',
  openGraph: {
    title: 'SmartX 服务管理中心',
    description: '管理服务请求、服务目录与业务引用数据的统一工作台。',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '服务目录｜SmartX 服务管理中心',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SmartX 服务管理中心',
    description: '管理服务请求、服务目录与业务引用数据的统一工作台。',
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
      <body>{children}<DemoAssistant /></body>
    </html>
  );
}
