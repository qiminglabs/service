'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, translateList, translateMessage, type Locale } from './translate';
import { readTranslations, translationsEvent } from './store';

const storageKey = 'smartx-service-language';
const LanguageContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void; labels: Record<string, string> }>({ locale: 'zh-CN', setLocale: () => {}, labels: {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const refresh = () => { void readTranslations().then(record => { if (active) setLabels(record.labels); }).catch(() => {}); };
    refresh();
    window.addEventListener(translationsEvent, refresh);
    window.addEventListener('focus', refresh);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(translationsEvent) : undefined;
    if (channel) channel.onmessage = refresh;
    return () => { active = false; window.removeEventListener(translationsEvent, refresh); window.removeEventListener('focus', refresh); channel?.close(); };
  }, []);
  const [locale, setLanguage] = useState<Locale>('zh-CN');
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { try { if (active && localStorage.getItem(storageKey) === 'en') setLanguage('en'); } catch { /* Language switching also works without browser storage. */ } });
    const sync = (event: StorageEvent) => { if (event.key === storageKey) setLanguage(event.newValue === 'en' ? 'en' : 'zh-CN'); };
    window.addEventListener('storage', sync);
    return () => { active = false; window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'en' ? 'SmartX Service Management Center' : 'SmartX 服务管理中心';
  }, [locale]);
  const value = useMemo(() => ({ locale, labels, setLocale(next: Locale) {
    setLanguage(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Retain the in-memory preference. */ }
  } }), [locale, labels]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// Context follows React portals, so configuration dialogs and shared controls
// retain Chinese without altering the user's language preference.
export function LanguageScope({ chinese, children }: { chinese: boolean; children: ReactNode }) {
  const inherited = useContext(LanguageContext);
  const value = useMemo(() => chinese ? { ...inherited, locale: 'zh-CN' as const } : inherited, [chinese, inherited]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const language = useContext(LanguageContext);
  return useMemo(() => ({ ...language, localize: <T,>(value: T): T => translate(value, language.locale, language.labels), localizeList: (values: readonly string[], separator?: string) => translateList(values, language.locale, language.labels, separator), localizeMessage: (source: string, values: readonly (string | number)[]) => translateMessage(source, values, language.locale, language.labels) }), [language]);
}

export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return <fieldset className="language-switch" aria-label={locale === 'en' ? 'Language' : '语言'}>
    <button type="button" lang="zh-CN" aria-pressed={locale === 'zh-CN'} onClick={() => setLocale('zh-CN')}>中文</button>
    <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
  </fieldset>;
}
