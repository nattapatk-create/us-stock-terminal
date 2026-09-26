import { memo, useEffect, useMemo, useState } from "react";
import { getLogoUrls } from "../utils/formatters.js";

export const StockLogo = memo(function StockLogo({ symbol, logoUrl, size = 24, className = "" }) {
  const [imgIdx, setImgIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  const logoUrls = useMemo(() => getLogoUrls(symbol, logoUrl), [symbol, logoUrl]);

  useEffect(() => {
    setImgIdx(0);
    setFailed(false);
  }, [symbol, logoUrl]);

  const handleError = () => {
    if (imgIdx < logoUrls.length - 1) {
      setImgIdx((prev) => prev + 1);
    } else {
      setFailed(true);
    }
  };

  if (failed || !logoUrls[imgIdx]) {
    const char = symbol ? symbol.charAt(0).toUpperCase() : "?";
    return (
      <div
        style={{ width: `${size}px`, height: `${size}px`, minWidth: `${size}px` }}
        className={`rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center font-mono font-bold text-zinc-300 text-[10px] select-none shrink-0 ${className}`}
        title={symbol}
      >
        {char}
      </div>
    );
  }

  return (
    <div
      style={{ width: `${size}px`, height: `${size}px`, minWidth: `${size}px` }}
      className={`rounded-full overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 p-0.5 ${className}`}
    >
      <img
        src={logoUrls[imgIdx]}
        alt={symbol}
        onError={handleError}
        className="w-full h-full object-contain rounded-full"
        loading="lazy"
      />
    </div>
  );
});

