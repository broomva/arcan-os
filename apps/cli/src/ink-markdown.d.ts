declare module 'ink-markdown' {
  import type { FC } from 'react';

  interface MarkdownProps {
    children: string;
  }

  const Markdown: FC<MarkdownProps>;
  export default Markdown;
}
