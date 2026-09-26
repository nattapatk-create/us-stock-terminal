import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { PRIORITY, getQuotaSnapshot, loadStore, saveStore, setFhDailyLimit, setFhRateLimit, setTdDailyLimit, setTdRateLimit, tdBatchSize } from "./api/quotaEngine.js";
import { CACHE_TTL_MS, getFhCallsToday, getTdCallsToday, isCacheEntryFresh, loadCachedEntry, pruneStorage, saveCachedEntry } from "./api/priceCache.js";
import { DEFAULT_TIMEFRAME, DEFAULT_WATCHLIST, MAX_SYMBOLS } from "./data/appConfig.js";
import { deriveQuoteFromSeries, fetchFundamentals, fetchProfile, fetchQuoteBalanced, fetchSeries, fetchSeriesBatch } from "./api/priceSeries.js";
import { clearApiKeys, hasAnySecret, initApiKeyVault, mergeApiKeys, saveApiKeys, splitSecrets, stripSecrets } from "./api/keyVault.js";
import { getStockName } from "./utils/formatters.js";
import { useToast } from "./hooks/useToast.js";
import { classifyCached } from "./utils/indicators.js";
import { Briefcase, Download, Grid3x3, PieChart, Radar, Settings, Upload } from "./components/icons.jsx";
import { QuotaMeter } from "./components/QuotaMeter.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { PortfolioView } from "./components/PortfolioView.jsx";
import { WatchlistTab } from "./components/WatchlistTab.jsx";
import { SectorRotationView } from "./components/SectorRotationView.jsx";
import { SP500HeatmapView } from "./components/SP500HeatmapView.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";

export function App() {
  const toast = useToast();
  const [symbols, setSymbols] = useState([]);
  const [dataMap, setDataMap] = useState({});
  const dataMapRef = useRef({});
  useEffect(() => {
    dataMapRef.current = dataMap;
  }, [dataMap]);
  const [tdKey, setTdKey] = useState("");
  const [fhKey, setFhKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [tdKeyDraft, setTdKeyDraft] = useState("");
  const [fhKeyDraft, setFhKeyDraft] = useState("");
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  // สถานะการเก็บ API key (เข้ารหัสอยู่ไหม / เก็บได้แค่ในหน่วยความจำ) — ใช้แสดงคำเตือนใน SettingsPanel
  const [vaultInfo, setVaultInfo] = useState({ status: "encrypted", legacyRemains: false });
  const [tdRatePerMin, setTdRatePerMin] = useState(8);
  const [tdRateDraft, setTdRateDraft] = useState("8");
  const [fhRatePerMin, setFhRatePerMin] = useState(60);
  const [fhRateDraft, setFhRateDraft] = useState("60");
  // เพดาน "ต่อวัน" ของแต่ละเจ้า — Twelve Data แผนฟรีจำกัด 800 credit/วัน ซึ่งเป็นตัวจำกัดที่แท้จริง
  // ของแอปนี้ (ไม่ใช่เพดานต่อนาที) ส่วน Finnhub แผนฟรีไม่จำกัดรายวัน = ใส่ 0 เพื่อบอกว่าไม่จำกัด
  const [tdDailyDraft, setTdDailyDraft] = useState("800");
  const [fhDailyDraft, setFhDailyDraft] = useState("0");
  const [quota, setQuota] = useState(() => getQuotaSnapshot());
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState("watchlist");
  const [input, setInput] = useState("");
  const [booted, setBooted] = useState(false);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [tdCallsToday, setTdCallsToday] = useState(0);
  const [fhCallsToday, setFhCallsToday] = useState(0);
  const cooldownRef = useRef(null);
  // cooldownRef.current ถูกตั้งเป็น setInterval ใน refreshAll() (ตัว event handler ไม่ใช่
  // useEffect เอง) จึงไม่มี cleanup อัตโนมัติของ React ให้ — ต้องเคลียร์เองตอน App unmount กัน
  // interval เดินเรียก setRefreshCooldown ต่อไปเรื่อย ๆ ทั้งที่ component ถูกถอดไปแล้ว
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const [watchlistTrendFilter, setWatchlistTrendFilter] = useState("ALL");
  const [watchlistSearch, setWatchlistSearch] = useState("");
  const deferredWatchlistSearch = useDeferredValue(watchlistSearch);

  useEffect(() => {
    (async () => {
      // กวาดแคชที่หมดอายุทิ้งก่อนเริ่มใช้งาน — กัน localStorage เต็มจนแคชหยุดทำงานเงียบ ๆ
      // (แคชที่พังคือสาเหตุอันดับหนึ่งที่ทำให้โควตา API ถูกเผาทิ้งโดยไม่มีใครสังเกต)
      pruneStorage();
      // API key ไม่ได้อยู่ใน "us-dash-keys" แล้ว (เหลือแค่ค่าโควตา) — อ่านจาก vault ที่เข้ารหัสแทน
      // และถ้าเจอ key แบบ plaintext จากเวอร์ชันเก่า จะย้ายเข้า vault ให้อัตโนมัติก่อนอ่านค่าอื่น
      const vault = await initApiKeyVault();
      const [keys, wl] = await Promise.all([
        loadStore("us-dash-keys", { tdRate: 8, fhRate: 60, tdDaily: 800, fhDaily: 0 }),
        loadStore("us-dash-watchlist", DEFAULT_WATCHLIST),
      ]);
      setVaultInfo({ status: vault.status, legacyRemains: vault.legacyRemains });
      setTdKey(vault.keys.td || "");
      setFhKey(vault.keys.fh || "");
      setGeminiKey(vault.keys.gemini || "");
      setTdKeyDraft(vault.keys.td || "");
      setFhKeyDraft(vault.keys.fh || "");
      setGeminiKeyDraft(vault.keys.gemini || "");
      const rate = keys.tdRate || 8;
      setTdRatePerMin(rate);
      setTdRateDraft(String(rate));
      setTdRateLimit(rate);
      const fhRate = keys.fhRate || 60;
      setFhRatePerMin(fhRate);
      setFhRateDraft(String(fhRate));
      setFhRateLimit(fhRate);
      const tdDaily = keys.tdDaily != null ? keys.tdDaily : 800;
      const fhDaily = keys.fhDaily != null ? keys.fhDaily : 0;
      setTdDailyDraft(String(tdDaily));
      setFhDailyDraft(String(fhDaily));
      setTdDailyLimit(tdDaily);
      setFhDailyLimit(fhDaily);
      setSymbols(wl);

      const cachedMap = {};
      wl.forEach((s) => {
        const cached = loadCachedEntry(s);
        if (cached) cachedMap[s] = { ...cached, loading: true, stale: true };
      });
      if (Object.keys(cachedMap).length > 0) {
        setDataMap((prev) => ({ ...cachedMap, ...prev }));
      }

      setBooted(true);
    })();
  }, []);

  // อัปเดตตัวเลขโควตาถี่ขึ้น (ทุก 2 วินาที) เพราะตอนนี้มีทั้งยอดใช้ต่อนาทีและความยาวคิวให้ดู
  // ด้วย — ผู้ใช้จะเห็นได้ทันทีว่าตอนนี้งานกองอยู่ที่ฝั่งไหน และเหลือโควตาวันละเท่าไร
  useEffect(() => {
    const tick = () => {
      setTdCallsToday(getTdCallsToday());
      setFhCallsToday(getFhCallsToday());
      setQuota(getQuotaSnapshot());
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const setEntry = useCallback((symbol, patch) => {
    setDataMap((prev) => ({ ...prev, [symbol]: { ...(prev[symbol] || {}), ...patch } }));
  }, []);

  // loadSymbol ตอนนี้ "คืนค่า (return)" entry ล่าสุดกลับไปเสมอ ไม่ว่าจะมาจากแคชหรือดึงใหม่
  // เหตุผล: ผู้เรียก (เช่นตัวสแกนหุ้นแนะนำประจำสัปดาห์) เดิมต้องอ่านผลลัพธ์ผ่าน dataMap/ref
  // ของ React ทันทีหลัง await ซึ่ง state update เป็น async อาจยังไม่อัปเดตทันในรอบเดียวกัน
  // ทำให้เช็คเงื่อนไข (เช่น "เจอครบ 10 ตัวหรือยัง") ผิดพลาดได้ การคืนค่าตรง ๆ ช่วยตัดปัญหานี้ทิ้ง
  // นอกจากนี้ยังรองรับ opts.skipFundamentals เพื่อข้ามการยิง Finnhub ระหว่างสแกนหาผู้เข้าเกณฑ์
  // (ประหยัดโควตา Finnhub มาก เพราะไม่ต้องยิงให้ทุกตัวที่สแกน แค่ตัวที่ผ่านเกณฑ์จริงเท่านั้น)
  const loadSymbol = useCallback(async (symbol, full = true, timeframe = DEFAULT_TIMEFRAME, opts = {}) => {
    const { forceRefresh = false, skipFundamentals = false } = opts;
    const fh = fhKey.trim();
    const needsFundamentals = full && !!fh && !skipFundamentals;

    // เช็คแคชก่อนยิง API ทุกครั้ง — ถ้าข้อมูล timeframe เดียวกันยังไม่หมดอายุ (ดู CACHE_TTL_MS)
    // และไม่ได้ถูกสั่ง forceRefresh (เช่นกดปุ่ม "อัปเดตทั้งหมด" หรือรีเฟรชรายตัว) ให้ใช้ของเดิม
    // ทันทีโดยไม่เรียก Twelve Data / Finnhub เลย ช่วยประหยัดโควตาเวลาเปิดแอปซ้ำ/สแกนซ้ำในวันเดียวกัน
    if (!forceRefresh) {
      const cached = loadCachedEntry(symbol);
      if (isCacheEntryFresh(cached, timeframe, needsFundamentals)) {
        const result = { ...cached, loading: false, error: null, stale: false };
        setEntry(symbol, result);
        return result;
      }
    }

    setEntry(symbol, { loading: true, error: null });
    try {
      const key = tdKey.trim();
      if (!key) throw new Error("ยังไม่ได้ใส่ Twelve Data API key (ตั้งค่า ⚙)");

      const fhPromise = needsFundamentals
        ? Promise.all([fetchFundamentals(symbol, fh), fetchProfile(symbol, fh)]).catch((fhErr) => {
            console.warn(`Finnhub error for ${symbol}:`, fhErr);
            return null;
          })
        : null;

      if (full) {
        // ยิง Twelve Data แค่ /time_series ครั้งเดียว แล้วคำนวณ "quote" จากแท่งล่าสุดแทนการ
        // ยิง /quote แยก — ลด credit ต่อสัญลักษณ์ลงครึ่งหนึ่งเมื่อเทียบกับโค้ดเดิม
        const series = await fetchSeries(symbol, key, timeframe);
        const quote = deriveQuoteFromSeries(series);
        // ใส่ cachedAt ตั้งแต่ตอนดึงสด ๆ ด้วย (เดิมมีแค่ตอนอ่านจากแคชเก่าเท่านั้น) เพื่อให้ UI
        // แสดง "อัปเดตล่าสุดเมื่อไร" ได้เสมอไม่ว่าข้อมูลจะมาจากแคชหรือดึงใหม่ก็ตาม
        let result = { quote, series, timeframe, loading: !!fhPromise, error: null, stale: false, cachedAt: Date.now() };
        setEntry(symbol, result);
        saveCachedEntry(symbol, result);

        if (fhPromise) {
          const fhResult = await fhPromise;
          if (fhResult) {
            const [fundamentals, profile] = fhResult;
            result = { ...result, fundamentals, profile, loading: false };
            setEntry(symbol, { fundamentals, profile, loading: false });
            saveCachedEntry(symbol, result);
          } else {
            result = { ...result, loading: false };
            setEntry(symbol, { loading: false });
          }
        }
        return result;
      } else {
        setEntry(symbol, { loading: false });
        return { loading: false };
      }
    } catch (e) {
      const errPatch = { loading: false, error: e.message || "โหลดข้อมูลไม่สำเร็จ" };
      setEntry(symbol, errPatch);
      return errPatch;
    }
  }, [tdKey, fhKey, setEntry]);

  // ============================================================
  // Batch loader หลายสัญลักษณ์พร้อมกัน — แก้ปัญหา "สแกนได้แค่ ~200 ตัวจากพูล 4,000 ตัว"
  // ------------------------------------------------------------
  // สาเหตุเดิม: ตัวสแกนหุ้นแนะนำ (WeeklyRecommendedPanel.scanCandidates) เรียก loadSymbol()
  // ทีละสัญลักษณ์ต่อรอบ ซึ่งแต่ละครั้งต้องเข้าคิว tdQueue ที่จำกัดจังหวะยิงจริงไว้ที่
  // ~tdMinIntervalMs ต่อ "1 คำขอ HTTP" (บนแพ็กเกจฟรี ~7.7 วินาที/คำขอ = 8 คำขอ/นาที) ทำให้
  // การไล่สแกนพูล 4,000 ตัวที่ไม่ได้อยู่ในแคชเลยต้องใช้เวลารวมหลายชั่วโมง (4,000 x ~7.7s ≈ 8.5
  // ชม.) ผู้ใช้จึงเห็นว่าสแกนไปได้แค่ ~200 ตัวแล้วยังไม่จบ
  // ทางแก้: ส่งทุกสัญลักษณ์เข้า fetchSeriesBatch() ซึ่งตอนนี้วิ่งผ่าน "ตัวรวบคำขอ" กลาง
  // (requestSeries) ที่จะรวมสัญลักษณ์ที่ขอในจังหวะใกล้กันให้เป็นคำขอเดียว ยุบสัญลักษณ์ซ้ำทิ้ง
  // และตัดขนาดก้อนตามเพดาน credit จริงของ Plan ให้เอง — จุดเรียกไม่ต้องเดาขนาดก้อนอีกต่อไป
  // ฟังก์ชันนี้คืนค่า map ต่อสัญลักษณ์ตรง ๆ (ไม่ต้องพึ่ง state ของ React ที่เป็น async) เพื่อให้
  // ผู้เรียกเช็คเงื่อนไข "เจอครบ SCAN_BUFFER หรือยัง" ได้ถูกต้องทันที
  const loadSymbolsBatch = useCallback(async (symbolsArr, timeframe = DEFAULT_TIMEFRAME) => {
    const key = tdKey.trim();
    const results = {};
    if (!key || !symbolsArr || symbolsArr.length === 0) return results;

    // เช็คแคชก่อนเสมอ (เหมือน loadSymbol) — ตัวที่แคชยังสดอยู่ไม่ต้องยิง API เลย มีแค่ตัวที่
    // แคชหมดอายุ/ไม่มีเท่านั้นที่จะถูกส่งไปรวมกลุ่มยิงจริง
    const toFetch = [];
    for (const symbol of symbolsArr) {
      const cached = loadCachedEntry(symbol);
      if (isCacheEntryFresh(cached, timeframe, false)) {
        const entry = { ...cached, loading: false, error: null, stale: false };
        results[symbol] = entry;
        setEntry(symbol, entry);
      } else {
        toFetch.push(symbol);
      }
    }

    const chunkSize = tdBatchSize();
    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const chunk = toFetch.slice(i, i + chunkSize);
      let seriesMap = {};
      try {
        seriesMap = await fetchSeriesBatch(chunk, key, timeframe);
      } catch (e) {
        if (e?.isQuotaExhausted) {
          console.warn("loadSymbolsBatch: โควตา Twelve Data รายวันหมด — หยุดโหลดส่วนที่เหลือ");
          break;
        }
        console.warn("loadSymbolsBatch: fetchSeriesBatch ล้มเหลวทั้งก้อน", e);
      }
      for (const symbol of chunk) {
        const series = seriesMap[symbol];
        if (series && series.length > 0) {
          const quote = deriveQuoteFromSeries(series);
          const entry = { quote, series, timeframe, loading: false, error: null, stale: false, cachedAt: Date.now() };
          results[symbol] = entry;
          setEntry(symbol, entry);
          saveCachedEntry(symbol, entry);
        } else {
          const entry = { loading: false, error: `ไม่พบข้อมูลราคาย้อนหลังของ ${symbol} (Twelve Data)` };
          results[symbol] = entry;
          setEntry(symbol, entry);
        }
      }
    }
    return results;
  }, [tdKey, setEntry]);

  // ดึงเฉพาะข้อมูลพื้นฐาน (Finnhub: metric + profile) แบบเบา ๆ โดยไม่แตะ Twelve Data/series เลย
  // ใช้สำหรับดึง Market Cap เฉพาะหุ้นที่ผ่านเกณฑ์ Strong Bullish แล้วเท่านั้น (ดู
  // WeeklyRecommendedPanel.scanCandidates) แทนที่จะยิง Finnhub ให้ทุกตัวที่สแกนหาเหมือนเดิม
  const loadFundamentalsOnly = useCallback(async (symbol) => {
    const fh = fhKey.trim();
    if (!fh) return null;
    const existing = dataMapRef.current[symbol];
    if (existing?.fundamentals && existing?.profile) return existing; // มีอยู่แล้ว ไม่ต้องยิงซ้ำ
    try {
      const [fundamentals, profile] = await Promise.all([
        fetchFundamentals(symbol, fh),
        fetchProfile(symbol, fh),
      ]);
      const merged = { ...(dataMapRef.current[symbol] || {}), fundamentals, profile };
      setEntry(symbol, { fundamentals, profile });
      saveCachedEntry(symbol, merged);
      return merged;
    } catch (e) {
      console.warn(`Finnhub error for ${symbol}:`, e);
      return null;
    }
  }, [fhKey, setEntry]);

  const loadSeries = useCallback(async (symbol, timeframe, opts = {}) => {
    const { forceRefresh = false } = opts;
    if (!forceRefresh) {
      const cached = loadCachedEntry(symbol);
      if (isCacheEntryFresh(cached, timeframe, false)) {
        setEntry(symbol, { ...cached, loading: false, error: null, stale: false });
        return;
      }
    }
    setEntry(symbol, { loading: true, error: null });
    try {
      const key = tdKey.trim();
      if (!key) throw new Error("ยังไม่ได้ใส่ Twelve Data API key (ตั้งค่า ⚙)");
      const series = await fetchSeries(symbol, key, timeframe);
      const quote = deriveQuoteFromSeries(series);
      const cachedAt = Date.now();
      setEntry(symbol, { quote, series, timeframe, loading: false, error: null, stale: false, cachedAt });
      const existing = dataMapRef.current[symbol] || {};
      saveCachedEntry(symbol, {
        quote,
        series,
        timeframe,
        fundamentals: existing.fundamentals,
        profile: existing.profile,
      });
    } catch (e) {
      setEntry(symbol, { loading: false, error: e.message || "โหลดข้อมูลไม่สำเร็จ" });
    }
  }, [tdKey, setEntry]);

  useEffect(() => {
    if (!booted || !tdKey.trim()) return;
    symbols.forEach((s) => loadSymbol(s, true, dataMapRef.current[s]?.timeframe || DEFAULT_TIMEFRAME));
  }, [booted, tdKey, fhKey]);

  const handleSymbolTimeframeChange = useCallback((symbol, tf) => {
    if (dataMapRef.current[symbol]?.quote) loadSeries(symbol, tf);
    else loadSymbol(symbol, true, tf);
  }, [loadSeries, loadSymbol]);

  const handleRefreshSymbol = useCallback((s) => {
    // ผู้ใช้กดรีเฟรชรายตัวเอง = ต้องการข้อมูลใหม่จริง ๆ (รวมแท่งราคา/อินดิเคเตอร์) จึงยิง
    // Twelve Data เต็มรูปแบบเหมือนเดิม เพราะเป็นการกดทีละตัว ไม่ใช่ภาระซ้ำ ๆ กับทุกสัญลักษณ์
    loadSymbol(s, true, dataMapRef.current[s]?.timeframe || DEFAULT_TIMEFRAME, { forceRefresh: true });
  }, [loadSymbol]);

  // อัปเดตเฉพาะ "ราคาล่าสุด" (quote) ผ่าน Finnhub แบบเบา ๆ โดยไม่แตะ Twelve Data เลย และไม่
  // กระทบแท่งราคา/อินดิเคเตอร์ที่คำนวณไว้แล้ว ใช้กับการรีเฟรชจำนวนมาก (ปุ่ม "รีเฟรชทั้งหมด")
  // เพื่อย้ายภาระส่วนใหญ่ไปที่ Finnhub ซึ่งมีโควตาเหลือเฟือกว่า Twelve Data มาก
  const refreshQuoteOnly = useCallback(async (symbol) => {
    const fh = fhKey.trim();
    if (!fh) return false; // ไม่มี Finnhub key ให้ผู้เรียก fallback ไปใช้ full refresh แทน
    try {
      const existing = dataMapRef.current[symbol] || {};
      const quote = await fetchQuoteBalanced(symbol, {
        fhKey: fh,
        tdKey: tdKey.trim(),
        fallbackSeries: existing.series,
        priority: PRIORITY.INTERACTIVE,
      });
      if (!quote) return false;
      setEntry(symbol, { quote, stale: false });
      saveCachedEntry(symbol, { ...existing, quote });
      return true;
    } catch (e) {
      console.warn(`Quick quote refresh ล้มเหลวสำหรับ ${symbol}:`, e.message);
      return false; // เงียบไว้โดยตั้งใจ ไม่ทับ error ของข้อมูลกราฟหลักด้วยความล้มเหลวของการอัปเดตราคาเบา ๆ
    }
  }, [fhKey, tdKey, setEntry]);

  // กติกาตายตัวของ Watchlist: รายชื่อหุ้นใน Watchlist (state `symbols`) จะถูกแก้ไข
  // ได้แค่ 2 ทางเท่านั้นคือ addSymbol (ผู้ใช้กดเพิ่มเอง) และ removeSymbol (ผู้ใช้กดลบเอง)
  // — รวมถึงตอนนำเข้าไฟล์ Backup ที่ผู้ใช้เลือกไฟล์เอง — ห้ามมีจุดอื่นใดในแอป (การสแกน,
  // การสลับ Timeframe, การรีเฟรชข้อมูล, ตัวจับเวลา auto-refresh ฯลฯ) เรียก setSymbols
  // หรือแก้ไข localStorage key "us-dash-watchlist" โดยพลการเด็ดขาด
  const addSymbol = useCallback((raw) => {
    const s = raw.trim().toUpperCase();
    if (!s) {
      toast.warning("กรุณาพิมพ์ชื่อย่อหุ้นก่อน เช่น TSLA, AAPL");
      return;
    }
    if (symbols.includes(s)) {
      toast.warning(`${s} อยู่ใน Watchlist แล้ว`);
      return;
    }
    if (symbols.length >= MAX_SYMBOLS) {
      toast.warning(`Watchlist เต็มแล้ว (สูงสุด ${MAX_SYMBOLS} ตัว) กรุณาลบหุ้นบางตัวออกก่อนเพิ่มใหม่`);
      return;
    }
    const next = [...symbols, s];
    setSymbols(next);
    saveStore("us-dash-watchlist", next);
    setInput("");
    if (tdKey.trim()) loadSymbol(s, true, DEFAULT_TIMEFRAME);
    toast.success(`เพิ่ม ${s} เข้า Watchlist แล้ว`);
  }, [symbols, tdKey, loadSymbol, toast]);

  const removeSymbol = useCallback((s) => {
    setSymbols((prev) => {
      const next = prev.filter((x) => x !== s);
      saveStore("us-dash-watchlist", next);
      return next;
    });
    toast.success(`ลบ ${s} ออกจาก Watchlist แล้ว`);
  }, [toast]);

  const refreshAll = useCallback(() => {
    if (refreshCooldown > 0) return;
    const fh = fhKey.trim();
    // จุดสมดุลภาระหลัก: "รีเฟรชทั้งหมด" เดิมยิง Twelve Data เต็มรูปแบบให้ทุกสัญลักษณ์ในครั้งเดียว
    // (แพงและช้าเพราะโดน rate limit เข้มของ Twelve Data) ตอนนี้แยกเป็น 2 กรณีต่อสัญลักษณ์:
    //   - แท่งราคา/อินดิเคเตอร์ยังสดอยู่ (ไม่เกิน CACHE_TTL_MS) และมี Finnhub key → อัปเดตแค่
    //     ราคาล่าสุดผ่าน Finnhub (เบา เร็ว ไม่แตะโควตา Twelve Data)
    //   - แท่งราคาเก่าเกินไป/ยังไม่เคยโหลด หรือไม่มี Finnhub key → ต้องยิง Twelve Data เต็ม
    //     รูปแบบเหมือนเดิม เพราะเป็นจุดเดียวที่ให้ข้อมูล candle ได้จริง
    symbols.forEach((s) => {
      const cached = dataMapRef.current[s];
      const seriesFresh = cached && cached.series && cached.series.length >= 20 &&
        cached.cachedAt && (Date.now() - cached.cachedAt) < CACHE_TTL_MS;
      if (fh && seriesFresh) {
        refreshQuoteOnly(s);
      } else {
        loadSymbol(s, true, cached?.timeframe || DEFAULT_TIMEFRAME, { forceRefresh: true });
      }
    });
    setRefreshCooldown(20);
    cooldownRef.current = setInterval(() => {
      setRefreshCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
  }, [refreshCooldown, symbols, loadSymbol, refreshQuoteOnly, fhKey]);

  const commitKeys = () => {
    const td = tdKeyDraft.trim();
    const fh = fhKeyDraft.trim();
    const gemini = geminiKeyDraft.trim();
    const rate = Math.max(1, parseInt(tdRateDraft, 10) || 8);
    const fhRate = Math.max(1, parseInt(fhRateDraft, 10) || 60);
    const tdDaily = Math.max(0, parseInt(tdDailyDraft, 10) || 0);
    const fhDaily = Math.max(0, parseInt(fhDailyDraft, 10) || 0);
    if (td !== tdKey) setTdKey(td);
    if (fh !== fhKey) setFhKey(fh);
    if (gemini !== geminiKey) setGeminiKey(gemini);
    setTdRatePerMin(rate);
    setTdRateDraft(String(rate));
    setTdRateLimit(rate);
    setFhRatePerMin(fhRate);
    setFhRateDraft(String(fhRate));
    setFhRateLimit(fhRate);
    setTdDailyLimit(tdDaily);
    setFhDailyLimit(fhDaily);
    setTdDailyDraft(String(tdDaily));
    setFhDailyDraft(String(fhDaily));
    setQuota(getQuotaSnapshot());
    // ค่าโควตา (ไม่ลับ) เก็บใน "us-dash-keys" ส่วน API key เข้ารหัสแล้วเก็บแยกใน vault
    saveStore("us-dash-keys", { tdRate: rate, fhRate, tdDaily, fhDaily });
    // ข้อความ toast ของส่วนนี้ตั้งใจให้เป็นข้อความตายตัว ไม่ใส่ค่า key/รายละเอียด error ใด ๆ ลงไป
    saveApiKeys({ td, fh, gemini })
      .then((info) => {
        setVaultInfo(info);
        if (info.status === "memory") {
          toast.warning("บันทึกการตั้งค่าแล้ว แต่เบราว์เซอร์นี้เก็บ API Key ลงเครื่องไม่ได้ Key จะอยู่ในหน่วยความจำจนกว่าจะปิดแท็บ");
        } else {
          toast.success("บันทึกการตั้งค่า API Key แล้ว");
        }
      })
      .catch(() => toast.error("บันทึก API Key ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"));
  };

  // ลบ API key ทั้งหมดออกจากเบราว์เซอร์นี้ (vault + plaintext เก่า) และล้างค่าที่ค้างในหน้าจอ
  const clearAllApiKeys = async () => {
    setTdKey(""); setFhKey(""); setGeminiKey("");
    setTdKeyDraft(""); setFhKeyDraft(""); setGeminiKeyDraft("");
    const info = await clearApiKeys();
    setVaultInfo(info);
    if (info.legacyRemains) {
      toast.warning("ลบ API Key แล้ว แต่ยังมี Key แบบเก่าค้างอยู่ในเบราว์เซอร์นี้ กดลบอีกครั้งเพื่อล้างให้หมด");
    } else {
      toast.success("ลบ API Key ทั้งหมดออกจากเบราว์เซอร์นี้แล้ว");
    }
  };

  const exportBackup = () => {
    try {
      // จุดบอดเดิม: Backup เก็บแค่ portfolios/watchlist/keys ทำให้ "ประวัติการทำรายการซื้อขาย"
      // (ใช้วาดกราฟการเติบโตของพอร์ตย้อนหลังใน PortfolioGrowthChart), เป้าหมายมูลค่าต่อพอร์ต,
      // และยอดเงินสดที่ตั้งไว้ หายไปทั้งหมดทุกครั้งที่ผู้ใช้ Import Backup ไปเครื่อง/เบราว์เซอร์ใหม่
      // (แอปจริงเก็บ 3 คีย์นี้ใน localStorage แยกต่างหาก แต่ exportBackup ไม่เคยอ่านมันเลย) —
      // เพิ่ม 3 คีย์นี้เข้า backup ให้ครบตามที่แอปเก็บจริง
      const data = {
        portfolios: JSON.parse(localStorage.getItem("us-dash-portfolios-v3") || "[]"),
        watchlist: JSON.parse(localStorage.getItem("us-dash-watchlist") || "[]"),
        // ไฟล์สำรองไม่รวม API key (เป็นไฟล์ plaintext ที่มักถูกส่ง/อัปโหลด/sync ต่อ) — ต้องกรอก key ใหม่หลังนำเข้า
        // ฟิลด์ชื่อ "keys" ยังคงไว้เพื่อให้ไฟล์สำรองเก่า/ใหม่นำเข้าข้ามรุ่นกันได้ (ตอนนี้มีแต่ค่าโควตา)
        keys: stripSecrets(JSON.parse(localStorage.getItem("us-dash-keys") || "{}")),
        txLedger: JSON.parse(localStorage.getItem("us-dash-tx-ledger-v1") || "[]"),
        portfolioGoals: JSON.parse(localStorage.getItem("us-dash-portfolio-goals-v1") || "{}"),
        cash: JSON.parse(localStorage.getItem("us-dash-cash-v1") || "{\"amount\":0,\"included\":false}"),
        version: "3.1.0",
        exportDate: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = `us-stock-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`ส่งออกข้อมูลสำรองแล้ว (${filename})`);
    } catch (err) {
      toast.error(`ส่งออกข้อมูลสำรองไม่สำเร็จ: ${err?.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ"}`);
    }
  };

  const importBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.portfolios) saveStore("us-dash-portfolios-v3", parsed.portfolios);
        if (parsed.watchlist) {
          saveStore("us-dash-watchlist", parsed.watchlist);
          setSymbols(parsed.watchlist);
        }
        // คืนค่าประวัติการทำรายการ/เป้าหมายพอร์ต/เงินสด — คีย์เหล่านี้ถูกอ่านใหม่จาก localStorage
        // ตอน PortfolioView/PortfolioGrowthChart mount ใหม่หลัง reload ด้านล่าง จึงไม่ต้องมี
        // setState ที่นี่ (state ของมันอยู่ใน PortfolioView ซึ่งเป็นคนละคอมโพเนนต์กับ App)
        if (Array.isArray(parsed.txLedger)) {
          saveStore("us-dash-tx-ledger-v1", parsed.txLedger);
        }
        if (parsed.portfolioGoals) {
          saveStore("us-dash-portfolio-goals-v1", parsed.portfolioGoals);
        }
        if (parsed.cash) {
          saveStore("us-dash-cash-v1", parsed.cash);
        }
        if (parsed.keys) {
          // ไฟล์สำรองรุ่นเก่าอาจมี API key แบบ plaintext ติดมา — แยกเข้า vault (เข้ารหัส) ไม่ให้กลับไปอยู่ใน
          // "us-dash-keys" อีก ต้อง await ให้เสร็จก่อน reload ด้านล่าง ไม่งั้น key จะหายกลางทาง
          const { secrets, settings } = splitSecrets(parsed.keys);
          saveStore("us-dash-keys", settings);
          if (hasAnySecret(secrets)) await mergeApiKeys(secrets);
          const rate = parsed.keys.tdRate || 8;
          setTdRatePerMin(rate);
          setTdRateDraft(String(rate));
          setTdRateLimit(rate);
          const fhRate = parsed.keys.fhRate || 60;
          setFhRatePerMin(fhRate);
          setFhRateDraft(String(fhRate));
          setFhRateLimit(fhRate);
          const tdDaily = parsed.keys.tdDaily != null ? parsed.keys.tdDaily : 800;
          const fhDaily = parsed.keys.fhDaily != null ? parsed.keys.fhDaily : 0;
          setTdDailyDraft(String(tdDaily));
          setFhDailyDraft(String(fhDaily));
          setTdDailyLimit(tdDaily);
          setFhDailyLimit(fhDaily);
        }
        // ต้อง reload เพื่อให้ทุกคอมโพเนนต์อ่านค่าใหม่จาก localStorage — toast ที่แสดงตอนนี้จะหายไปพร้อมหน้า
        // จึงฝากไว้ให้โผล่หลังโหลดหน้าใหม่แทน
        toast.showAfterReload("success", "นำเข้าข้อมูลสำรองสำเร็จเรียบร้อย");
        window.location.reload();
      } catch (err) {
        toast.error(`ไฟล์สำรองไม่ถูกต้อง: ${err?.message || "อ่านข้อมูลไม่ได้"}`);
      }
    };
    reader.onerror = () => toast.error("อ่านไฟล์สำรองไม่สำเร็จ กรุณาลองเลือกไฟล์ใหม่");
    reader.readAsText(file);
  };

  const filteredWatchlistSymbols = useMemo(() => {
    return symbols.filter((sym) => {
      const entry = dataMap[sym];
      const fullName = getStockName(sym, entry?.profile?.name).toUpperCase();
      const query = deferredWatchlistSearch.toUpperCase();
      const searchMatch = !query || sym.includes(query) || fullName.includes(query);
      if (!searchMatch) return false;

      if (watchlistTrendFilter === "ALL") return true;

      if (entry && entry.series && entry.series.length > 20) {
        const cls = classifyCached(entry.series);
        return cls.trend === watchlistTrendFilter;
      }
      return true;
    });
  }, [symbols, dataMap, deferredWatchlistSearch, watchlistTrendFilter]);

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100 pb-10">
      <div className="sticky top-0 z-20 border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-wrap bg-zinc-950/85 backdrop-blur-md shadow-[0_1px_0_0_rgba(128,135,248,0.08)]">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-950/50 shrink-0">
          <Radar size={18} className="text-white" />
        </div>
        <div>
          <div className="font-semibold text-sm flex items-center gap-2 tracking-tight">
            US Stock Terminal
          </div>
          <div className="text-[11px] text-zinc-500">Twelve Data (แท่งราคา & อินดิเคเตอร์) | Finnhub (ราคาล่าสุด & งบการเงิน & โลโก้)</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <QuotaMeter quota={quota} tdCallsToday={tdCallsToday} fhCallsToday={fhCallsToday} />
          <button
            onClick={exportBackup}
            className="flex items-center gap-1 text-xs bg-zinc-900/70 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-lg text-zinc-300 transition-colors"
            title="ส่งออกข้อมูลสำรอง (ไม่รวม API Key)"
          >
            <Download size={13} /> สำรองข้อมูล
          </button>
          <label className="flex items-center gap-1 text-xs bg-zinc-900/70 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-lg text-zinc-300 cursor-pointer transition-colors">
            <Upload size={13} /> นำเข้าข้อมูล
            <input type="file" accept=".json" onChange={importBackup} className="hidden" />
          </label>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-blue-300 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/70 transition-colors"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          tdKeyDraft={tdKeyDraft} setTdKeyDraft={setTdKeyDraft}
          fhKeyDraft={fhKeyDraft} setFhKeyDraft={setFhKeyDraft}
          geminiKeyDraft={geminiKeyDraft} setGeminiKeyDraft={setGeminiKeyDraft}
          tdRateDraft={tdRateDraft} setTdRateDraft={setTdRateDraft}
          fhRateDraft={fhRateDraft} setFhRateDraft={setFhRateDraft}
          tdDailyDraft={tdDailyDraft} setTdDailyDraft={setTdDailyDraft}
          fhDailyDraft={fhDailyDraft} setFhDailyDraft={setFhDailyDraft}
          vaultInfo={vaultInfo}
          onClearKeys={clearAllApiKeys}
          onSave={() => { commitKeys(); setShowSettings(false); }}
        />
      )}

      <div className="px-4 border-b border-zinc-800 flex items-center justify-between gap-2 overflow-x-auto bg-zinc-950">
        <div className="flex gap-1 py-2">
          <button
            onClick={() => setTab("portfolio")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === "portfolio" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md shadow-blue-950/40" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"}`}
          >
            <Briefcase size={14} /> พอร์ตลงทุน (Multi-Portfolio)
          </button>
          <button
            onClick={() => setTab("watchlist")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === "watchlist" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md shadow-blue-950/40" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"}`}
          >
            <Radar size={14} /> Watchlist & Technical
          </button>
          <button
            onClick={() => setTab("sector")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === "sector" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md shadow-blue-950/40" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"}`}
          >
            <PieChart size={14} /> Sector Rotation
          </button>
          <button
            onClick={() => setTab("heatmap")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === "heatmap" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md shadow-blue-950/40" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"}`}
          >
            <Grid3x3 size={14} /> S&amp;P 500 Heatmap
          </button>
        </div>
      </div>

      {/* เดิมแต่ละแท็บใช้ {tab === "x" && (...)} ซึ่งทำให้ React "ถอด (unmount)" คอมโพเนนต์ของ
          แท็บที่ไม่ได้ดูอยู่ทั้งหมดออกจากหน้าจอทันที เมื่อสลับกลับมาใหม่ React จะ "สร้างใหม่
          (mount ใหม่)" ทั้งคอมโพเนนต์ ทำให้ state ภายในของแท็บนั้นรีเซ็ตหมด (เช่น sectorData,
          scannedAt, universe ของ WeeklyRecommendedPanel, ฟอร์ม/ตัวกรองต่าง ๆ ใน PortfolioView)
          และ effect ที่ผูกกับ "ตอน mount" ก็ถูกยิงซ้ำใหม่ทุกครั้ง (เช่นสแกน Sector/Weekly ใหม่)
          ตอนนี้เปลี่ยนมาให้ "mount ทุกแท็บไว้ตลอด" แล้วใช้ CSS class "hidden" ซ่อนแท็บที่ไม่ได้
          ดูอยู่แทน (display:none) — คอมโพเนนต์และ state ภายในจะยังอยู่ครบ ไม่ถูกทำลาย/สร้างใหม่
          เวลาสลับแท็บไปมา จึงไม่ต้องโหลด/สแกนข้อมูลซ้ำอีกเลย */}
      {/* ครอบแต่ละแท็บด้วย ErrorBoundary แยกกัน — ถ้าแท็บใดพัง แท็บอื่นยังใช้งานได้ และมีปุ่ม "ลองใหม่"
          ต้องให้ ErrorBoundary อยู่ "ใต้" div ที่ซ่อน/แสดงตามแท็บ (ไม่ใช่ข้างนอก) ไม่งั้น fallback UI ของ
          แท็บที่พังจะโผล่ค้างอยู่ทุกแท็บ เพราะมันจะไม่ถูก class "hidden" ซ่อนไปด้วย */}
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <div className={tab === "portfolio" ? "" : "hidden"}>
          <ErrorBoundary name="พอร์ตลงทุน">
            <PortfolioView tdKey={tdKey} fhKey={fhKey} geminiKey={geminiKey} dataMap={dataMap} loadSymbol={loadSymbol} refreshQuoteOnly={refreshQuoteOnly} />
          </ErrorBoundary>
        </div>

        <div className={tab === "watchlist" ? "" : "hidden"}>
          <ErrorBoundary name="Watchlist & Technical">
            <WatchlistTab
              active={tab === "watchlist"}
              tdKey={tdKey} fhKey={fhKey} dataMap={dataMap} loadSymbol={loadSymbol}
              loadSymbolsBatch={loadSymbolsBatch} loadFundamentalsOnly={loadFundamentalsOnly}
              symbols={symbols} addSymbol={addSymbol}
              input={input} setInput={setInput}
              watchlistSearch={watchlistSearch} setWatchlistSearch={setWatchlistSearch}
              watchlistTrendFilter={watchlistTrendFilter} setWatchlistTrendFilter={setWatchlistTrendFilter}
              refreshAll={refreshAll} refreshCooldown={refreshCooldown}
              filteredWatchlistSymbols={filteredWatchlistSymbols} removeSymbol={removeSymbol}
              handleRefreshSymbol={handleRefreshSymbol} handleSymbolTimeframeChange={handleSymbolTimeframeChange}
            />
          </ErrorBoundary>
        </div>

        <div className={tab === "sector" ? "" : "hidden"}>
          <ErrorBoundary name="Sector Rotation">
            <SectorRotationView tdKey={tdKey} />
          </ErrorBoundary>
        </div>

        <div className={tab === "heatmap" ? "" : "hidden"}>
          <ErrorBoundary name="S&P 500 Heatmap">
            <SP500HeatmapView tdKey={tdKey} fhKey={fhKey} onAdd={addSymbol} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

