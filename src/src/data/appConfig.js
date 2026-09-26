/* ============================================================
   TIMEFRAMES CONFIGURATION
   ============================================================ */
export const TIMEFRAMES = [
  { id: "1day", label: "1D", name: "1 วัน" },
  { id: "1week", label: "1W", name: "1 สัปดาห์" }
];
export const DEFAULT_TIMEFRAME = "1week";

/* ============================================================
   DATA SOURCES & QUEUES
   ============================================================ */
export const TD_BASE = "https://api.twelvedata.com";
export const FH_BASE = "https://finnhub.io/api/v1";
export const DEFAULT_WATCHLIST = ["NVDA", "AAPL", "TSLA", "PLTR", "RKLB"];
export const MAX_SYMBOLS = 20;
