'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Fragment } from 'react';

type Props = {
  href: string;
  children: ReactNode;
  title: string;
};

/** מונח טכני עם קישור לאקדמיה — תווית מוצגת בעברית. */
export function AcademyTerm({ href, children, title }: Props) {
  return (
    <Link
      href={href}
      title={title}
      className="border-b border-dotted border-cyan-400/50 text-cyan-200/95 hover:border-amber-400/60 hover:text-amber-200/95 transition-colors underline-offset-2"
    >
      {children}
    </Link>
  );
}

const TERM_PATTERNS: Array<{ re: RegExp; href: string; title: string; display: string }> = [
  { re: /\bDXY\b/gi, href: '/academy#glossary-dxy', title: 'מדד הדולר מול סל מטבעות — מדריך באקדמיה', display: 'מדד דולר' },
  { re: /\bCVD\b/gi, href: '/academy#glossary-cvd', title: 'נפח מצטבר דלתא — מדריך באקדמיה', display: 'נפח דלתא מצטבר' },
  { re: /ספופינג/g, href: '/academy#glossary-spoofing', title: 'הצגת פקודות מדומות בספר — מדריך באקדמיה', display: 'ספופינג' },
  { re: /\bSpoofing\b/gi, href: '/academy#glossary-spoofing', title: 'הצגת פקודות מדומות בספר — מדריך באקדמיה', display: 'ספופינג' },
];

/** מפצל טקסט נימוק ומקשר מונחים לאקדמיה. */
export function RationaleWithAcademyTerms({ text }: { text: string }): ReactNode {
  let parts: Array<string | { href: string; title: string; label: string }> = [text];

  for (const { re, href, title, display } of TERM_PATTERNS) {
    const next: Array<string | { href: string; title: string; label: string }> = [];
    for (const p of parts) {
      if (typeof p !== 'string') {
        next.push(p);
        continue;
      }
      const r = new RegExp(re.source, 'gi');
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = r.exec(p)) !== null) {
        if (m.index > last) next.push(p.slice(last, m.index));
        next.push({ href, title, label: display });
        last = m.index + m[0].length;
      }
      if (last < p.length) next.push(p.slice(last));
    }
    parts = next;
  }

  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <AcademyTerm key={i} href={p.href} title={p.title}>
            {p.label}
          </AcademyTerm>
        )
      )}
    </>
  );
}
