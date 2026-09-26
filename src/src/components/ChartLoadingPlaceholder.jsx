export function ChartLoadingPlaceholder({ height = 240 }) {
  return (
    <div
      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/40 flex items-center justify-center text-[11px] text-zinc-500 font-mono animate-pulse"
      style={{ height }}
    >
      กำลังเตรียมกราฟ...
    </div>
  );
}

