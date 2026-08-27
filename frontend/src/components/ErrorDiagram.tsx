interface Props {
  category: string;
  message: string;
  line: number;
  codeLine: string; // the actual source line the error is on, for context
}

const COLORS = {
  error: "#dc2626",
  ok: "#16a34a",
  neutral: "#64748b",
  bg: "#fef2f2",
};

export default function ErrorDiagram({ category, message, line, codeLine }: Props) {
  switch (category) {
    case "missing-semicolon":
      return <MissingSemicolonDiagram codeLine={codeLine} />;
    case "unmatched-brace":
      return <BraceMatchDiagram codeLine={codeLine} />;
    case "undeclared-identifier":
    case "implicit-declaration":
      return <UndeclaredDiagram codeLine={codeLine} message={message} />;
    case "type-mismatch":
    case "format-string":
      return <TypeMismatchDiagram message={message} />;
    case "uninitialized":
      return <UninitializedDiagram codeLine={codeLine} />;
    case "linker":
      return <LinkerDiagram message={message} />;
    default:
      return <GenericDiagram line={line} />;
  }
}

function Frame({ children, height = 90 }: { children: React.ReactNode; height?: number }) {
  return (
    <svg viewBox={`0 0 400 ${height}`} width="100%" height={height} style={{ background: COLORS.bg, borderRadius: 8 }}>
      {children}
    </svg>
  );
}

function MissingSemicolonDiagram({ codeLine }: { codeLine: string }) {
  const trimmed = codeLine.trim().slice(0, 30);
  return (
    <Frame height={70}>
      <text x="16" y="30" fontFamily="monospace" fontSize="14" fill="#334155">
        {trimmed}
      </text>
      <text x={16 + trimmed.length * 8.4} y="30" fontFamily="monospace" fontSize="16" fill={COLORS.error} fontWeight="bold">
        ▌
      </text>
      <text x="16" y="55" fontSize="12" fill={COLORS.error}>
        ↑ the compiler expected a semicolon right here
      </text>
    </Frame>
  );
}

function BraceMatchDiagram({ codeLine }: { codeLine: string }) {
  const opens = (codeLine.match(/{/g) || []).length;
  const closes = (codeLine.match(/}/g) || []).length;
  return (
    <Frame height={90}>
      <text x="16" y="24" fontSize="12" fill={COLORS.neutral}>
        Every {"{"} needs a matching {"}"}
      </text>
      {Array.from({ length: Math.max(opens, closes, 1) }).map((_, i) => (
        <g key={i}>
          <rect x={16 + i * 50} y="36" width="18" height="18" rx="3" fill={i < opens ? "#dbeafe" : "#fee2e2"} stroke={i < opens ? "#2563eb" : COLORS.error} />
          <text x={16 + i * 50 + 5} y="50" fontFamily="monospace" fontSize="13">{"{"}</text>
          <rect x={16 + i * 50} y="60" width="18" height="18" rx="3" fill={i < closes ? "#dcfce7" : "#fee2e2"} stroke={i < closes ? "#16a34a" : COLORS.error} />
          <text x={16 + i * 50 + 5} y="74" fontFamily="monospace" fontSize="13">{"}"}</text>
        </g>
      ))}
    </Frame>
  );
}

function UndeclaredDiagram({ codeLine, message }: { codeLine: string; message: string }) {
  const match = message.match(/['"`]([a-zA-Z_]\w*)['"`]/);
  const name = match?.[1] ?? "?";
  return (
    <Frame height={90}>
      <text x="16" y="24" fontFamily="monospace" fontSize="13" fill="#334155">
        {codeLine.trim().slice(0, 36)}
      </text>
      <rect x="16" y="34" width={name.length * 9 + 12} height="24" rx="4" fill="none" stroke={COLORS.error} strokeDasharray="3,2" />
      <text x="16" y="70" fontSize="12" fill={COLORS.error}>
        "{name}" is used here but was never declared above this line
      </text>
    </Frame>
  );
}

function TypeMismatchDiagram({ message }: { message: string }) {
  return (
    <Frame height={90}>
      <rect x="16" y="20" width="160" height="40" rx="6" fill="#dbeafe" stroke="#2563eb" />
      <text x="96" y="45" textAnchor="middle" fontSize="12" fill="#1e40af">what you gave it</text>
      <text x="200" y="45" fontSize="18" fill={COLORS.neutral}>≠</text>
      <rect x="224" y="20" width="160" height="40" rx="6" fill="#fee2e2" stroke={COLORS.error} />
      <text x="304" y="45" textAnchor="middle" fontSize="12" fill="#991b1b">what it expected</text>
      <text x="16" y="78" fontSize="11" fill={COLORS.neutral}>{message.slice(0, 60)}</text>
    </Frame>
  );
}

function UninitializedDiagram({ codeLine }: { codeLine: string }) {
  return (
    <Frame height={80}>
      <rect x="16" y="20" width="90" height="36" rx="6" fill="#fef3c7" stroke="#d97706" />
      <text x="61" y="43" textAnchor="middle" fontSize="12" fill="#92400e">? ? ?</text>
      <text x="120" y="43" fontSize="12" fill={COLORS.neutral}>← this variable's value is garbage until you assign it</text>
      <text x="16" y="70" fontFamily="monospace" fontSize="12" fill="#334155">{codeLine.trim().slice(0, 40)}</text>
    </Frame>
  );
}

function LinkerDiagram({ message }: { message: string }) {
  const match = message.match(/undefined reference to [`']([^'`]+)['`]/);
  const fn = match?.[1] ?? "a function";
  return (
    <Frame height={80}>
      <rect x="16" y="20" width="140" height="36" rx="6" fill="#f1f5f9" stroke={COLORS.neutral} />
      <text x="86" y="43" textAnchor="middle" fontFamily="monospace" fontSize="12">{fn}(...)</text>
      <text x="170" y="38" fontSize="16" fill={COLORS.error}>✕</text>
      <text x="16" y="70" fontSize="12" fill={COLORS.error}>
        called but never defined anywhere in your program
      </text>
    </Frame>
  );
}

function GenericDiagram({ line }: { line: number }) {
  return (
    <Frame height={60}>
      <circle cx="30" cy="30" r="14" fill="#fee2e2" stroke={COLORS.error} />
      <text x="30" y="35" textAnchor="middle" fontSize="14" fill={COLORS.error} fontWeight="bold">!</text>
      <text x="56" y="35" fontSize="12" fill="#334155">Take a closer look at line {line}</text>
    </Frame>
  );
}