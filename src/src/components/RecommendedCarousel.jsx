import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "./icons.jsx";
import { RecommendedStockCard } from "./RecommendedStockCard.jsx";

export function RecommendedCarousel({ items, symbols, onAdd }) {
  const trackRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);
  const [activeDot, setActiveDot] = useState(0);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    const cardW = el.firstChild ? el.firstChild.getBoundingClientRect().width + 12 : 1;
    setActiveDot(Math.round(el.scrollLeft / cardW));
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [items, updateScrollState]);

  const scrollByCards = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const cardW = el.firstChild ? el.firstChild.getBoundingClientRect().width + 12 : 260;
    el.scrollBy({ left: dir * cardW * 2, behavior: "smooth" });
  };

  const scrollToIndex = (i) => {
    const el = trackRef.current;
    if (!el || !el.children[i]) return;
    el.children[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  return (
    <div className="relative">
      <button
        onClick={() => scrollByCards(-1)}
        disabled={!canLeft}
        aria-label="เลื่อนซ้าย"
        className="hidden sm:flex items-center justify-center absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 shadow-lg shadow-black/40 hover:bg-zinc-800 hover:text-amber-400 disabled:opacity-0 disabled:pointer-events-none transition"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={() => scrollByCards(1)}
        disabled={!canRight}
        aria-label="เลื่อนขวา"
        className="hidden sm:flex items-center justify-center absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 shadow-lg shadow-black/40 hover:bg-zinc-800 hover:text-amber-400 disabled:opacity-0 disabled:pointer-events-none transition"
      >
        <ChevronRight size={16} />
      </button>

      <div
        ref={trackRef}
        onScroll={updateScrollState}
        className="flex gap-3 overflow-x-auto no-scrollbar snap-x-mandatory scroll-pl-1 pb-1 pt-2.5 px-1"
      >
        {items.map((rec, idx) => (
          <RecommendedStockCard
            key={rec.symbol}
            rec={rec}
            idx={idx}
            alreadyAdded={symbols.includes(rec.symbol)}
            onAdd={onAdd}
          />
        ))}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {items.map((rec, i) => (
            <button
              key={rec.symbol}
              onClick={() => scrollToIndex(i)}
              aria-label={`ไปที่หุ้น #${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === activeDot ? "w-5 bg-amber-400" : "w-1.5 bg-zinc-700 hover:bg-zinc-600"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

