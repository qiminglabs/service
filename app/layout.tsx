import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '服务目录与模板｜SmartX 服务管理中心',
  description: '统一维护专业服务目录、标准执行步骤与交付物要求的管理后台。',
  openGraph: {
    title: '服务目录与模板｜SmartX 服务管理中心',
    description: '统一维护专业服务目录、标准执行步骤与交付物要求的管理后台。',
  },
  twitter: {
    card: 'summary_large_image',
    title: '服务目录与模板｜SmartX 服务管理中心',
    description: '统一维护专业服务目录、标准执行步骤与交付物要求的管理后台。',
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
