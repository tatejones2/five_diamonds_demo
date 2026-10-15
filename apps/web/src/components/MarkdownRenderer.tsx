import ReactMarkdown from 'react-markdown';

export default function MarkdownRenderer({ children }: { children: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ href, children: c }) => {
          const safe = href && /^(https?:|mailto:|tel:|\/)/i.test(href) ? href : undefined;
          const external = safe?.startsWith('http');
          return (
            <a href={safe} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {c}
            </a>
          );
        },
        img: () => null,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
