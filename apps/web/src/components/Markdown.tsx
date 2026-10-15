import { lazy, Suspense } from 'react';

// The Markdown pipeline (~100 KB) loads on demand so it stays out of the critical public bundle.
const Renderer = lazy(() => import('./MarkdownRenderer'));

/** CMS Markdown. Raw HTML is never rendered (ADR-010), so stored content cannot inject scripts. */
export function Markdown({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  return (
    <div className={`prose-fd ${className ?? ''}`}>
      <Suspense fallback={<p className="whitespace-pre-line">{children.replace(/[#*_`>[\]]/g, '')}</p>}>
        <Renderer>{children}</Renderer>
      </Suspense>
    </div>
  );
}
