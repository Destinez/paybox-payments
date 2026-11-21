import Image from 'next/image';

export function TerminalFrame({
  path,
  image,
  alt,
  width = 2000,
  height = 1200,
  preload = false,
  children,
}: {
  path: string;
  image?: string;
  alt?: string;
  width?: number;
  height?: number;
  preload?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="terminal-frame">
      <div className="terminal-title">
        <span className="terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{path}</span>
        <span className="terminal-mode">Test mode</span>
      </div>
      {image ? (
        <Image
          src={image}
          alt={alt ?? 'Actual Paybox test-mode operations screen'}
          width={width}
          height={height}
          sizes="(max-width: 760px) 90vw, 1100px"
          preload={preload}
        />
      ) : (
        children
      )}
    </div>
  );
}
