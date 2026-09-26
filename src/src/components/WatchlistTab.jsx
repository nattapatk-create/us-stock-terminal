import { WeeklyRecommendedPanel } from "./WeeklyRecommendedPanel.jsx";
import { RefreshCw, Search } from "./icons.jsx";
import { TickerCard } from "./TickerCard.jsx";

export function WatchlistTab({
  active,
  tdKey, fhKey, dataMap, loadSymbol, loadSymbolsBatch, loadFundamentalsOnly, symbols, addSymbol,
  input, setInput,
  watchlistSearch, setWatchlistSearch,
  watchlistTrendFilter, setWatchlistTrendFilter,
  refreshAll, refreshCooldown,
  filteredWatchlistSymbols, removeSymbol, handleRefreshSymbol, handleSymbolTimeframeChange,
}) {
  return (
    <div className={active ? "space-y-4" : "hidden"}>
            <WeeklyRecommendedPanel
              tdKey={tdKey}
              fhKey={fhKey}
              dataMap={dataMap}
              loadSymbol={loadSymbol}
              loadSymbolsBatch={loadSymbolsBatch}
              loadFundamentalsOnly={loadFundamentalsOnly}
              symbols={symbols}
              onAdd={addSymbol}
            />

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
              <form
                onSubmit={(e) => { e.preventDefault(); addSymbol(input); }}
                className="flex items-center gap-2 flex-1 min-w-[240px]"
              >
                <input
                  type="text"
                  placeholder="เพิ่มหุ้นเข้า Watchlist เช่น TSLA, AAPL..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-100 font-mono flex-1 uppercase"
                />
                <button type="submit" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium text-white shrink-0">
                  + เพิ่ม
                </button>
              </form>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="ค้นหา Symbol หรือชื่อ..."
                    value={watchlistSearch}
                    onChange={(e) => setWatchlistSearch(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded pl-8 pr-2 py-1 text-xs text-zinc-100 w-36 focus:w-48 transition-all"
                  />
                </div>
                <select
                  value={watchlistTrendFilter}
                  onChange={(e) => setWatchlistTrendFilter(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 font-mono"
                >
                  <option value="ALL">ทุกเทรนด์</option>
                  <option value="Uptrend">ขาขึ้น (Uptrend)</option>
                  <option value="Downtrend">ขาลง (Downtrend)</option>
                  <option value="Sideways">แกว่งตัว (Sideways)</option>
                </select>

                <button
                  onClick={refreshAll}
                  disabled={refreshCooldown > 0}
                  title="ราคาล่าสุดของสัญลักษณ์ที่แท่งราคายังสดอยู่จะอัปเดตผ่าน Finnhub (เบา ไม่ใช้โควตา Twelve Data) ส่วนสัญลักษณ์ที่แท่งราคาเก่าเกินไปจะดึงใหม่เต็มรูปแบบผ่าน Twelve Data"
                  className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs text-zinc-300 flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw size={13} className={refreshCooldown > 0 ? "animate-spin" : ""} />
                  {refreshCooldown > 0 ? `${refreshCooldown}s` : "อัปเดตทั้งหมด"}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {filteredWatchlistSymbols.map((sym) => (
                <TickerCard
                  key={sym}
                  symbol={sym}
                  entry={dataMap[sym]}
                  onRemove={removeSymbol}
                  onRefresh={handleRefreshSymbol}
                  onTimeframeChange={handleSymbolTimeframeChange}
                />
              ))}
              {filteredWatchlistSymbols.length === 0 && (
                <div className="text-center text-zinc-500 py-12 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
                  ไม่พบรายการหุ้นตรงตามเงื่อนไขค้นหา
                </div>
              )}
            </div>
    </div>
  );
}
