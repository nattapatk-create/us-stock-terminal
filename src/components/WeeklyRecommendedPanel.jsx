import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { TRENDING_UNIVERSE } from "../data/trendingUniverse.js";
import { GLOBAL_UNIVERSE_TARGET_SIZE, fetchFundamentals, fetchGlobalStockUniverse, fetchProfile, fetchSeriesBatch, pick } from "../api/priceSeries.js";
import { loadStore, saveStore } from "../api/quotaEngine.js";
import { NEWS_MIN_COUNT, SCAN_BUFFER, SCAN_CHECKPOINT_KEY, SOCIAL_MIN_MENTIONS, WEEKLY_PICKS_STORE_KEY, WEEKLY_PICK_COUNT, computeInvestorInterest, computeTechnicalSignal, computeTrendScore, fetchCompanyNewsCount7d, fetchSocialSentiment7d, fundScanBatchSize, getCapTier, getFundamentalEligibility, getGrowthSignals, getRiskFlags, getWeeklyRotationOrder, techScanBatchSize } from "../api/recommendationScan.js";
import { SCAN_OUTPUTSIZE } from "../utils/indicators.js";
import { DEFAULT_TIMEFRAME } from "../data/appConfig.js";
import { getCountryMeta } from "../utils/formatters.js";
import { Zap } from "./icons.jsx";
import { RecommendedCarousel } from "./RecommendedCarousel.jsx";

export const WeeklyRecommendedPanel = memo(function WeeklyRecommendedPanel({ tdKey, fhKey, dataMap, loadSymbol, loadSymbolsBatch, loadFundamentalsOnly, symbols, onAdd }) {
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, found: 0 });
  // true = การสแกนถูกพักไว้เพราะโควตา Twelve Data รายวันหมด (ไม่ใช่ error — จะไปต่อเองวันถัดไป)
  const [quotaPaused, setQuotaPaused] = useState(false);
  // fundamentalsMap เก็บ object metric ดิบจาก Finnhub (/stock/metric?metric=all) ต่อ symbol —
  // ใช้คำนวณคะแนนเสริมจากปัจจัยพื้นฐาน (ข้อ 4 — Revenue/EPS Growth + P/E สำหรับป้ายความเสี่ยง)
  const [fundamentalsMap, setFundamentalsMap] = useState({});
  // newsMap เก็บจำนวนข่าวบริษัทในช่วง 7 วันล่าสุดต่อ symbol (Finnhub /company-news) — ใช้ประกอบ
  // เกณฑ์บังคับข้อ 1 "ความสนใจจากนักลงทุน"
  const [newsMap, setNewsMap] = useState({});
  // socialMap เก็บยอดพูดถึง Reddit/Twitter 7 วันล่าสุดต่อ symbol (Finnhub /stock/social-sentiment)
  // — ใช้ประกอบเกณฑ์บังคับข้อ 1 คู่กับข่าว
  const [socialMap, setSocialMap] = useState({});
  // eligibilityMap เก็บผลเช็คเกณฑ์บังคับ (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) ต่อ symbol — แทนที่
  // บทบาทเดิมของ technicalMap ในการเป็น "ตัวกรองบังคับ" (ดูหัวข้อเกณฑ์การคัดกรองด้านบน)
  const [eligibilityMap, setEligibilityMap] = useState({});
  // technicalMap เก็บผลวิเคราะห์ Volume + โมเมนตัมราคาจากแท่งราคา "รายวัน" ต่อ symbol — ตอนนี้
  // เป็น "ข้อมูลเสริม" แสดงผล/ให้คะแนนเล็กน้อยบนการ์ดเท่านั้น ไม่ใช่เกณฑ์บังคับอีกต่อไป (ดึงมา
  // เฉพาะหุ้นที่ผ่านเกณฑ์บังคับแล้ว และเฉพาะเมื่อมี Twelve Data API Key)
  // เก็บแยกจาก dataMap ของแอปโดยตั้งใจ (ไม่ผ่าน loadSymbolsBatch) เพราะ dataMap/cache ใช้
  // Timeframe เดียวกับที่ Watchlist หลักแสดงผล (ค่าเริ่มต้น "1week") ถ้าใช้ dataMap ร่วมกันจะทำให้
  // สัญลักษณ์ที่ผู้ใช้เพิ่มไว้ใน Watchlist อยู่แล้วถูกสแกนเนอร์ทับด้วยแท่งราคารายวันโดยไม่ได้ตั้งใจ
  const [technicalMap, setTechnicalMap] = useState({});

  // พูลหุ้นสำหรับสแกน = หุ้นที่คัดสรรไว้ล่วงหน้า (TRENDING_UNIVERSE) รวมกับหุ้นสามัญทั่วโลก
  // อีกก้อนใหญ่ที่ดึงมาจาก Twelve Data (ดู fetchGlobalStockUniverse ด้านบน) รวมกันสูงสุด
  // ~GLOBAL_UNIVERSE_TARGET_SIZE ตัว เพื่อขยายโอกาสเจอหุ้นที่เข้าเกณฑ์เทรนด์ให้กว้างกว่าลิสต์
  // คัดสรรอย่างเดียว — ระหว่างที่ยังดึงไม่เสร็จ (หรือดึงไม่สำเร็จ) จะยังไม่เริ่มสแกนจนกว่า
  // universeReady จะเป็น true (ดู effect ด้านล่าง) เพื่อกันไม่ให้สแกนซ้ำสองรอบด้วยพูลคนละขนาดกัน
  const [globalUniverse, setGlobalUniverse] = useState(null);
  const [universeReady, setUniverseReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUniverseReady(false);
    fetchGlobalStockUniverse(tdKey).then((items) => {
      if (cancelled) return;
      setGlobalUniverse(items);
      setUniverseReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tdKey]);

  const universe = useMemo(() => {
    if (!globalUniverse || globalUniverse.length === 0) return TRENDING_UNIVERSE;
    const seen = new Set(TRENDING_UNIVERSE.map((it) => it.symbol));
    const merged = [...TRENDING_UNIVERSE];
    for (const item of globalUniverse) {
      if (merged.length >= GLOBAL_UNIVERSE_TARGET_SIZE) break;
      if (seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      merged.push(item);
    }
    return merged;
  }, [globalUniverse]);

  const today = useMemo(() => {
    const d = new Date();
    const formattedDate = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekKey = monday.toISOString().slice(0, 10);
    return {
      date: formattedDate,
      weekKey,
      displayDate: `${monday.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} - ${sunday.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}`,
      rotation: getWeeklyRotationOrder(weekKey, universe),
    };
  }, [universe]);

  // ดึงแท่งราคา "รายวัน" ของหลายสัญลักษณ์ทีละก้อน (ขนาดก้อนอิงเพดาน credit จริง) แล้วคำนวณผล
  // วิเคราะห์เทคนิค (computeTechnicalSignal) กลับมาเป็น map ต่อ symbol — ใช้ทั้งตอนสแกนใหม่และ
  // ตอนโหลดผลลัพธ์ที่ "ล็อก" ไว้แล้วของสัปดาห์นี้ (เพื่อให้การ์ดแสดงตัวเลข Volume/โมเมนตัมได้)
  const loadTechnicalSignals = useCallback(async (symbolsArr) => {
    const out = {};
    const techChunk = techScanBatchSize();
    for (let i = 0; i < symbolsArr.length; i += techChunk) {
      const chunk = symbolsArr.slice(i, i + techChunk);
      let seriesMap = {};
      try {
        seriesMap = await fetchSeriesBatch(chunk, tdKey, "1day", SCAN_OUTPUTSIZE);
      } catch (e) {
        // โควตารายวันหมด = ยิงต่อไปก็ได้แค่ error ซ้ำ ๆ — หยุดทันทีแล้วคืนเท่าที่ได้มา
        if (e?.isQuotaExhausted) {
          console.warn("[Scanner] หยุดสแกนเพราะโควตา Twelve Data รายวันหมดแล้ว");
          break;
        }
        console.warn("[Scanner] fetchSeriesBatch (รายวัน) ล้มเหลวทั้งก้อน", e);
      }
      for (const sym of chunk) {
        const signal = computeTechnicalSignal(seriesMap[sym]);
        if (signal) out[sym] = signal;
      }
    }
    return out;
  }, [tdKey]);

  const scanCandidates = useCallback(async () => {
    if (!fhKey) return; // เกณฑ์บังคับใหม่ (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) ต้องใช้ Finnhub เป็นหลัก
    setLoading(true);
    const rotationPool = today.rotation;

    try {
      // เช็คก่อนเสมอว่าสัปดาห์นี้ (weekKey ปัจจุบัน) เคยสแกนอัตโนมัติจนได้ผลลัพธ์แล้วหรือยัง
      // (เก็บไว้ใน localStorage) — ถ้าเคยแล้ว ให้ใช้ชุดหุ้นเดิมที่ "ล็อก" ไว้ทันที โดยไม่ไล่สแกน
      // พูลทั้งหมดซ้ำอีกเลย (สแกนแค่ครั้งเดียวต่อสัปดาห์จริง ๆ ไม่มีปุ่มให้กดสแกนซ้ำเองแล้ว)
      const locked = await loadStore(WEEKLY_PICKS_STORE_KEY, null);
      if (locked && locked.weekKey === today.weekKey && Array.isArray(locked.symbols) && locked.symbols.length > 0) {
        setScanProgress({ done: locked.symbols.length, total: locked.symbols.length, found: locked.symbols.length });
        const cachedElig = locked.eligibility && typeof locked.eligibility === "object" ? locked.eligibility : {};
        setEligibilityMap((prev) => ({ ...prev, ...cachedElig }));
        // โหลดปัจจัยพื้นฐาน + ข่าว + โซเชียลของชุดหุ้นที่ล็อกไว้แล้วมาแสดงตัวเลขจริงบนการ์ด
        // (ไม่ต้องกรองซ้ำ เพราะสัปดาห์นี้ผ่านเกณฑ์บังคับไปแล้วตอนสแกนครั้งแรก — ค่าเหล่านี้แคช
        // ไว้ระดับ symbol อยู่แล้วผ่าน readFhCache/writeFhCache จึงไม่เปลืองโควตาซ้ำถ้ายังไม่หมดอายุ)
        const [fundEntries, newsEntries, socialEntries] = await Promise.all([
          Promise.all(locked.symbols.map(async (sym) => [sym, await fetchFundamentals(sym, fhKey).catch(() => null)])),
          Promise.all(locked.symbols.map(async (sym) => [sym, await fetchCompanyNewsCount7d(sym, fhKey).catch(() => null)])),
          Promise.all(locked.symbols.map(async (sym) => [sym, await fetchSocialSentiment7d(sym, fhKey).catch(() => null)])),
        ]);
        setFundamentalsMap(Object.fromEntries(fundEntries));
        setNewsMap(Object.fromEntries(newsEntries));
        setSocialMap(Object.fromEntries(socialEntries));
        // โมเมนตัมราคา (tech) เป็น "ข้อมูลเสริม" เท่านั้นตอนนี้ ไม่ใช่เกณฑ์บังคับ — ดึงเฉพาะเมื่อ
        // มี Twelve Data API Key ไว้ (ไม่มีก็ยังแสดงการ์ดได้ตามปกติ แค่ไม่มีตัวเลข Vol/4W)
        if (tdKey) {
          const tech = await loadTechnicalSignals(locked.symbols);
          setTechnicalMap((prev) => ({ ...prev, ...tech }));
          await loadSymbolsBatch(locked.symbols, DEFAULT_TIMEFRAME);
        }
        if (loadFundamentalsOnly) {
          await Promise.all(locked.symbols.map((sym) => loadFundamentalsOnly(sym)));
        }
        return;
      }

      // มี checkpoint ของสัปดาห์นี้ค้างอยู่ไหม (= วันก่อนสแกนค้างไว้เพราะโควตาหมด) ถ้ามีก็สแกนต่อ
      // จากตำแหน่งเดิม พร้อมหิ้วรายชื่อที่ผ่านเกณฑ์มาแล้วติดมาด้วย ไม่ต้องเริ่มนับหนึ่งใหม่
      const checkpoint = await loadStore(SCAN_CHECKPOINT_KEY, null);
      const resumable = checkpoint && checkpoint.weekKey === today.weekKey && Number.isFinite(checkpoint.cursor);
      let cursor = resumable ? Math.max(0, checkpoint.cursor) : 0;
      let doneCount = resumable ? (checkpoint.done || cursor) : 0;
      const shortlistSymbols = resumable && Array.isArray(checkpoint.shortlist) ? [...checkpoint.shortlist] : [];
      let foundCount = shortlistSymbols.length;
      if (resumable) {
        console.log(`[Scanner] สแกนต่อจากจุดที่ค้างไว้: ตำแหน่ง ${cursor}/${rotationPool.length} (ผ่านเกณฑ์มาแล้ว ${foundCount} ตัว)`);
      }
      setQuotaPaused(false);
      setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });

      let stoppedByQuota = false;
      // สะสมผลตรวจเกณฑ์บังคับ (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) "ของทุกตัวที่เช็กแล้ว" (ไม่ใช่แค่
      // ตัวที่ผ่าน) เพราะ eligibility/fund/news/social ของทุกสัญลักษณ์ใช้ต่อในการแสดงผล/คำนวณ
      // คะแนนอยู่ดี พร้อมสืบทอดของเดิมจาก checkpoint มาด้วย จะได้ไม่ต้องยิงซ้ำหลังสแกนต่อจากวันก่อน
      const eligResults = resumable && checkpoint.eligibility && typeof checkpoint.eligibility === "object" ? { ...checkpoint.eligibility } : {};
      const fundResults = resumable && checkpoint.fund && typeof checkpoint.fund === "object" ? { ...checkpoint.fund } : {};
      const newsResults = resumable && checkpoint.news && typeof checkpoint.news === "object" ? { ...checkpoint.news } : {};
      const socialResults = resumable && checkpoint.social && typeof checkpoint.social === "object" ? { ...checkpoint.social } : {};

      // ไล่สแกนพูลทั้งก้อนด้วย Finnhub เป็นหลัก (metric + company-news + social-sentiment ต่อ
      // สัญลักษณ์ บวก profile2 เฉพาะสัญลักษณ์ที่ยังไม่รู้ sector) เป็น "ก้อน" (batch) ขนาดเท่าเพดาน
      // คำขอต่อนาทีที่ยิงผ่านได้จริง (ดู fundScanBatchSize) แล้วหยุดทันทีเมื่อพบผู้เข้าเกณฑ์บังคับ
      // ครบ SCAN_BUFFER ตัว (Fast Stop) เพื่อประหยัดโควตา ไม่ต้องไล่สแกนพูลทั้งหมดเสมอไป
      const chunkSize = fundScanBatchSize();
      outer:
      for (let i = cursor; i < rotationPool.length; i += chunkSize) {
        if (foundCount >= SCAN_BUFFER) break;
        cursor = i; // ตำแหน่งของก้อนที่กำลังจะยิง — ใช้เป็นจุดกลับมาสแกนต่อถ้าโควตาหมดตรงนี้

        const batchItems = rotationPool.slice(i, i + chunkSize);
        let quotaHit = false;
        const pairs = await Promise.all(
          batchItems.map(async (item) => {
            const sym = item.symbol;
            try {
              const [fund, news, social, profile] = await Promise.all([
                fetchFundamentals(sym, fhKey),
                fetchCompanyNewsCount7d(sym, fhKey),
                fetchSocialSentiment7d(sym, fhKey),
                item.sector ? Promise.resolve(null) : fetchProfile(sym, fhKey),
              ]);
              return { item, fund, news, social, profile };
            } catch (e) {
              if (e?.isQuotaExhausted) quotaHit = true;
              return { item, fund: null, news: null, social: null, profile: null };
            }
          })
        );

        for (const { item, fund, news, social, profile } of pairs) {
          doneCount++;
          const sym = item.symbol;
          const growth = getGrowthSignals(fund);
          const sector = item.sector || profile?.finnhubIndustry || null;
          const interest = computeInvestorInterest(news, social);
          const fundamental = getFundamentalEligibility({ growth, sector, hasCatalyst: !!item.catalyst });
          fundResults[sym] = fund;
          newsResults[sym] = news;
          socialResults[sym] = social;

          if (interest.eligible && fundamental.eligible) {
            eligResults[sym] = { interest, fundamental, sector };
            shortlistSymbols.push(sym);
            foundCount++;
          }

          if (foundCount >= SCAN_BUFFER) {
            console.log(`[Scanner] พบหุ้นเข้าเกณฑ์บังคับครบ ${SCAN_BUFFER} ตัวแล้ว หยุดการสแกนทันที (ประหยัดโควตา API)`);
            break;
          }
        }

        if (quotaHit && foundCount < SCAN_BUFFER) {
          console.warn("[Scanner] พักการสแกน: โควตา Finnhub รายวันหมด — บันทึกจุดพักไว้แล้ว จะสแกนต่อเองในวันถัดไป");
          stoppedByQuota = true;
          break outer;
        }
        if (foundCount >= SCAN_BUFFER) break outer;
        cursor = i + chunkSize; // ก้อนนี้สำเร็จแล้ว เลื่อนจุดกลับมาสแกนต่อไปข้างหน้า
        setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });
      }
      setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });
      setEligibilityMap((prev) => ({ ...prev, ...eligResults }));
      setFundamentalsMap((prev) => ({ ...prev, ...fundResults }));
      setNewsMap((prev) => ({ ...prev, ...newsResults }));
      setSocialMap((prev) => ({ ...prev, ...socialResults }));

      // โมเมนตัมราคา/กราฟล่าสุด (Twelve Data, ข้อมูลเสริมเท่านั้น) + โปรไฟล์บริษัท (Finnhub
      // profile2 — ชื่อ, โลโก้, อุตสาหกรรม, Market Cap) เฉพาะหุ้นที่ "ผ่านเกณฑ์บังคับแล้วเท่านั้น"
      // เพื่อแสดงผลบนการ์ด
      if (tdKey && shortlistSymbols.length > 0) {
        const tech = await loadTechnicalSignals(shortlistSymbols);
        setTechnicalMap((prev) => ({ ...prev, ...tech }));
        await loadSymbolsBatch(shortlistSymbols, DEFAULT_TIMEFRAME);
      }
      if (loadFundamentalsOnly && shortlistSymbols.length > 0) {
        await Promise.all(shortlistSymbols.map((sym) => loadFundamentalsOnly(sym)));
      }

      if (stoppedByQuota) {
        // ยังสแกนไม่จบ — บันทึกเป็น "จุดพัก" ไม่ใช่ผลสุดท้าย เพื่อไม่ให้ชุดหุ้นที่ยังไม่ครบถูก
        // ล็อกค้างไว้ทั้งสัปดาห์ ครั้งหน้าที่เปิดแอป (โควตาวันใหม่) จะสแกนต่อจากตรงนี้เอง
        setQuotaPaused(true);
        await saveStore(SCAN_CHECKPOINT_KEY, {
          weekKey: today.weekKey,
          cursor,
          done: doneCount,
          shortlist: shortlistSymbols,
          eligibility: eligResults,
          fund: fundResults,
          news: newsResults,
          social: socialResults,
          savedAt: Date.now(),
        });
        return;
      }

      // "ล็อก" ผลสแกนของสัปดาห์นี้ไว้ใน localStorage — ครั้งต่อไปที่เปิดเว็บมาดูหรือสลับแท็บ
      // (หรือแม้แต่มาเปิดใหม่ทั้งแอปในสัปดาห์เดียวกัน) จะใช้ชุดหุ้นนี้ทันทีโดยไม่สแกนซ้ำ จนกว่า
      // จะขึ้นสัปดาห์ใหม่ (weekKey เปลี่ยน) ถึงจะสแกนชุดใหม่โดยอัตโนมัติ
      await saveStore(WEEKLY_PICKS_STORE_KEY, {
        weekKey: today.weekKey,
        symbols: shortlistSymbols,
        // เก็บผลตรวจเกณฑ์บังคับไปพร้อมกัน เพื่อให้การเปิดหน้าครั้งต่อ ๆ ไปในสัปดาห์เดียวกัน
        // แสดงผลได้ทันทีโดยไม่ต้องยิง Finnhub ซ้ำเพื่อเช็กเกณฑ์อีก (ข้อมูลตัวเลขยังรีเฟรชได้ผ่าน
        // แคช fh-* ตามอายุแคชปกติ)
        eligibility: Object.fromEntries(shortlistSymbols.filter((sym) => eligResults[sym]).map((sym) => [sym, eligResults[sym]])),
        savedAt: Date.now(),
      });
      // สแกนจบสมบูรณ์แล้ว ไม่ต้องเก็บจุดพักไว้อีก
      try { localStorage.removeItem(SCAN_CHECKPOINT_KEY); } catch {}
    } finally {
      setLoading(false);
    }
  }, [tdKey, fhKey, today, loadSymbolsBatch, loadFundamentalsOnly, loadTechnicalSignals]);

  useEffect(() => {
    // รอให้พูลหุ้นทั่วโลก (ดู fetchGlobalStockUniverse) โหลดเสร็จก่อนเสมอ (หรือ fail-open
    // กลับไปใช้ TRENDING_UNIVERSE ถ้าโหลดไม่สำเร็จ) ก่อนเริ่มสแกน — กันไม่ให้สแกนซ้ำสองรอบ
    // ด้วยพูลคนละขนาดกัน (รอบแรกจากพูลเล็กแล้วรอบสองจากพูลใหญ่ที่โหลดมาทีหลัง)
    if (!universeReady) return;
    scanCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today.weekKey, tdKey, fhKey, universeReady]);

  // ตารางค้นหา metadata ของสัญลักษณ์ (ประเทศ/sector/catalyst) แบบ O(1) — สร้างครั้งเดียวต่อพูล
  const poolIndex = useMemo(() => {
    const m = new Map();
    for (const item of universe) m.set(item.symbol, item);
    return m;
  }, [universe]);

  // เดิม memo นี้ไล่ลูปพูลทั้งก้อน (หลักพันตัว) ใหม่ทุกครั้งที่ dataMap/technicalMap เปลี่ยน
  // ซึ่งเกิดถี่มากระหว่างสแกน = งานเปล่าหลักแสนรอบต่อการสแกนหนึ่งครั้ง ตอนนี้วนเฉพาะสัญลักษณ์
  // ที่ผ่านเกณฑ์จริง (ไม่เกิน SCAN_BUFFER ตัว) แล้วเปิดตาราง metadata เอา
  const recommended = useMemo(() => {
    const candidates = [];
    for (const symbol of Object.keys(eligibilityMap)) {
      const elig = eligibilityMap[symbol];
      if (!elig) continue;
      const item = poolIndex.get(symbol) || { symbol, country: null, sector: elig.sector || null, catalyst: null };
      const fundamentals = fundamentalsMap[symbol];
      const growth = getGrowthSignals(fundamentals);
      const newsCount = newsMap[symbol];
      const social = socialMap[symbol];
      const tech = technicalMap[symbol]; // ข้อมูลเสริมเท่านั้น (อาจไม่มีถ้าไม่ได้ตั้ง Twelve Data API Key)
      const entry = dataMap[symbol];
      const mktCapB = ((pick(fundamentals, ["marketCapitalization"]) || entry?.profile?.marketCapitalization || 0) * 1e6) / 1e9;
      const countryMeta = getCountryMeta(item.country);
      const riskFlags = getRiskFlags(tech, growth);
      const score = computeTrendScore({
        tech, growth, newsCount,
        mentions: social?.mentions ?? null,
        growthPositive: elig.fundamental?.growthPositive,
        hotSector: elig.fundamental?.hotSector,
        hasCatalyst: !!item.catalyst,
      });
      candidates.push({
        ...item,
        sector: item.sector || elig.sector || null,
        tech, growth, newsCount, social, riskFlags, score,
        mktCapB,
        capTier: getCapTier(mktCapB),
        countryMeta,
        region: countryMeta.region,
        quote: entry?.quote,
        profile: entry?.profile,
      });
    }

    // เรียงจาก "คะแนนรวมสูงสุด" ก่อนเสมอ (ดู computeTrendScore — น้ำหนักหลักจากความสนใจนักลงทุน
    // (ข่าว + โซเชียล) เสริมด้วยปัจจัยพื้นฐาน/sector ร้อนแรง/catalyst และโมเมนตัมราคาถ้ามีข้อมูล)
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, WEEKLY_PICK_COUNT);
  }, [poolIndex, dataMap, fundamentalsMap, newsMap, socialMap, technicalMap, eligibilityMap]);

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-zinc-900 to-emerald-500/10 border border-amber-500/30 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
            <Zap className="fill-amber-400" size={18} />
            <span>หุ้นแนะนำประจำสัปดาห์ 🔥 หุ้นเทรนด์ขาขึ้น ({WEEKLY_PICK_COUNT} ตัว)</span>
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            เกณฑ์บังคับ: ความสนใจนักลงทุน (ข่าว ≥ {NEWS_MIN_COUNT} ข่าว/7 วัน หรือยอดพูดถึงโซเชียล ≥ {SOCIAL_MIN_MENTIONS} ครั้ง/7 วัน) + ปัจจัยพื้นฐานเป็นบวก/อยู่ใน sector ร้อนแรง เสริมคะแนนด้วยโมเมนตัมราคา (ถ้ามี Twelve Data) จากพูลหุ้นทั่วโลก ~{GLOBAL_UNIVERSE_TARGET_SIZE.toLocaleString()} ตัว
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-zinc-950 border border-zinc-800 text-amber-400 px-3 py-1 rounded-md font-bold">
            📅 {today.displayDate}
          </span>
        </div>
      </div>

      {!fhKey && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-[11px] text-amber-300 flex items-start gap-2">
          <span>⚠️</span>
          <span>
            ต้องตั้งค่า <strong>Finnhub API Key</strong> ก่อน (ใช้เช็คข่าว 7 วัน + ยอดพูดถึงโซเชียล + แนวโน้มรายได้/กำไร ซึ่งเป็นเกณฑ์บังคับหลัก) จึงจะสแกนเพื่อหาหุ้นแนะนำประจำสัปดาห์ได้ — ตั้งค่าได้ที่เมนู ⚙ มุมขวาบน
          </span>
        </div>
      )}

      {fhKey && !tdKey && (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-2.5 text-[11px] text-zinc-400 flex items-start gap-2">
          <span>ℹ️</span>
          <span>
            ยังไม่ได้ตั้งค่า <strong>Twelve Data API Key</strong> — ยังสแกนเกณฑ์บังคับ (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) ได้ตามปกติ แต่จะไม่มีราคา/กราฟ และไม่มีตัวเลขโมเมนตัมราคา (Volume/4W) เสริมบนการ์ด
          </span>
        </div>
      )}

      {loading && (
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 text-center text-xs text-amber-300 font-mono">
          ⚡ กำลังสแกนจากพูลหุ้นทั่วโลก... พบผู้เข้าเกณฑ์บังคับแล้ว {scanProgress.found}/{SCAN_BUFFER} ตัว (เช็กไปแล้ว {scanProgress.done}/{scanProgress.total} ตัว)
        </div>
      )}

      {!loading && quotaPaused && (
        <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-3 text-xs text-blue-200 leading-relaxed">
          ⏸️ พักการสแกนไว้ชั่วคราว เพราะใช้โควตา Finnhub ครบตามที่ตั้งไว้สำหรับวันนี้แล้ว —
          สแกนไปได้ {scanProgress.done}/{scanProgress.total} ตัว พบผู้เข้าเกณฑ์ {scanProgress.found}/{SCAN_BUFFER} ตัว
          <div className="text-blue-300/70 mt-1">
            ระบบบันทึกจุดที่ค้างไว้แล้ว เปิดแอปอีกครั้งในวันถัดไปจะสแกนต่อจากตรงนี้เอง ไม่ต้องเริ่มใหม่ —
            หุ้นที่ผ่านเกณฑ์แล้วด้านล่างยังดูได้ตามปกติ (ถ้าต้องการให้จบเร็วขึ้น ปรับเพดานโควตารายวันในหน้าตั้งค่า ⚙ ให้ตรงกับ Plan ที่ใช้จริง)
          </div>
        </div>
      )}

      {!loading && recommended.length === 0 && (
        <div className="text-xs text-zinc-500 text-center py-6">
          {fhKey
            ? "ยังไม่พบหุ้นที่มีความสนใจจากนักลงทุน (ข่าว/โซเชียล) พร้อมปัจจัยพื้นฐานเป็นบวกในสัปดาห์นี้"
            : "กรุณาตั้งค่า Finnhub API Key เพื่อเริ่มใช้งานหุ้นแนะนำประจำสัปดาห์"}
        </div>
      )}

      {recommended.length > 0 && (
        <RecommendedCarousel items={recommended} symbols={symbols} onAdd={onAdd} />
      )}
    </div>
  );
});

/* ============================================================
   PRICE CHART
   ============================================================ */
// จำนวนแท่งที่แสดงบนกราฟ (ของเดิมตัดแค่ 90 แท่งสุดท้ายเพื่อความเร็ว) — EMA/RSI/MACD ยังคำนวณ
// จาก series เต็มเสมอ (ไม่ใช่แค่ 90 แท่งที่ตัดมาโชว์) เพื่อไม่ให้ค่าเพี้ยนจากการตัดข้อมูลทิ้ง
export const CHART_VISIBLE_BARS = 90;

