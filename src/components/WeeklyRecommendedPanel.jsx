import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TRENDING_UNIVERSE } from "../data/trendingUniverse.js";
import { GLOBAL_UNIVERSE_TARGET_SIZE, fetchFundamentals, fetchGlobalStockUniverse, pick } from "../api/priceSeries.js";
import { loadStore, saveStore } from "../api/quotaEngine.js";
import { describeApiErrorForLog } from "../api/apiError.js";
import { FAIR_VALUE_RATIO, MAX_VALUATION_RATIO, MIN_DISRUPTIVE_GROWTH_PCT, MIN_TARGET_CAGR_PCT, REVALUATION_YEARS, SCAN_BUFFER, SCAN_CHECKPOINT_KEY, WEEKLY_PICKS_STORE_KEY, WEEKLY_PICK_COUNT, fundScanBatchSize, getCapTier, getHypergrowthEligibility, getWeeklyRotationOrder } from "../api/recommendationScan.js";
import { DEFAULT_TIMEFRAME } from "../data/appConfig.js";
import { getCountryMeta } from "../utils/formatters.js";
import { Zap } from "./icons.jsx";
import { RecommendedCarousel } from "./RecommendedCarousel.jsx";

export const WeeklyRecommendedPanel = memo(function WeeklyRecommendedPanel({ tdKey, fhKey, dataMap, loadSymbol, loadSymbolsBatch, loadFundamentalsOnly, symbols, onAdd }) {
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, found: 0 });
  // true = การสแกนถูกพักไว้เพราะโควตา Finnhub รายวัน/ต่อนาทีหมด (ไม่ใช่ error — จะไปต่อเองรอบถัดไป)
  const [quotaPaused, setQuotaPaused] = useState(false);
  // fundamentalsMap เก็บ object metric ดิบจาก Finnhub (/stock/metric?metric=all) ต่อ symbol —
  // เป็นแหล่งข้อมูลเดียวของเกณฑ์ Hypergrowth VI ทั้ง 3 ข้อ (Disruptive Growth + Margin of Safety +
  // เป้าหมายผลตอบแทน) และใช้เอา Market Cap มาแบ่ง Cap Tier ด้วย
  const [fundamentalsMap, setFundamentalsMap] = useState({});
  // eligibilityMap เก็บผลเช็คเกณฑ์บังคับทั้ง 3 ข้อ (ดู getHypergrowthEligibility) ต่อ symbol —
  // เป็น "ตัวกรองบังคับ" เดียวของระบบตอนนี้ ไม่มีเกณฑ์ทางเทคนิค/ข่าว/โซเชียล/sector-keyword
  // เข้ามาปะปนแล้ว (โละทิ้งทั้งหมดตามที่กำหนด — เน้นตัวเลขงบการเงิน/มูลค่าล้วน ๆ)
  const [eligibilityMap, setEligibilityMap] = useState({});

  // พูลหุ้นสำหรับสแกน = หุ้นที่คัดสรรไว้ล่วงหน้า (TRENDING_UNIVERSE — ใช้เป็นแค่ผู้สมัครเริ่มต้น
  // และข้อมูลประเทศ/sector สำหรับแสดงผลเท่านั้น ไม่มีผลต่อการผ่าน/ไม่ผ่านเกณฑ์แล้ว) รวมกับหุ้น
  // สามัญทั่วโลกอีกก้อนใหญ่ที่ดึงมาจาก Twelve Data (ดู fetchGlobalStockUniverse ด้านบน) รวมกัน
  // สูงสุด ~GLOBAL_UNIVERSE_TARGET_SIZE ตัว เพื่อขยายโอกาสเจอหุ้น Hypergrowth VI ให้กว้างที่สุด
  // ทั่วโลกตามที่กำหนด (ไม่จำกัดแค่ตลาดสหรัฐฯ) — ระหว่างที่ยังดึงไม่เสร็จ (หรือดึงไม่สำเร็จ) จะยัง
  // ไม่เริ่มสแกนจนกว่า universeReady จะเป็น true (ดู effect ด้านล่าง)
  const [globalUniverse, setGlobalUniverse] = useState(null);
  const [universeReady, setUniverseReady] = useState(false);

  // scanRef.token ป้องกันสแกน "ซ้อนกัน" — scanCandidates เป็นงานที่กินเวลานาน เรียกจาก useEffect
  // ด้านล่างซึ่งมี tdKey/fhKey/today.weekKey เป็น dependency — ถ้าผู้ใช้เปลี่ยน API key หรือข้าม
  // สัปดาห์ระหว่างที่สแกนรอบเก่ายังไม่จบ effect จะยิงสแกนรอบใหม่ทับ ทำให้มีสองรอบสแกนวิ่งพร้อมกัน
  // จริง ๆ (คำขอ HTTP ซ้ำซ้อน โควตาโดนเผาสองเท่า และ state ของรอบเก่าเขียนทับรอบใหม่แบบสุ่มลำดับ)
  // แพตเทิร์นนี้ยืมมาจาก scanRef ของ SP500HeatmapView — ทุกจุดที่จะ setState ต้องเช็ค isCurrent() ก่อนเสมอ
  const scanRef = useRef({ token: 0 });
  // isMountedRef กัน setState หลัง component ถูกถอดออกไปแล้ว (แยกจาก token เพราะ token กันแค่
  // "สแกนเก่าทับสแกนใหม่" แต่ไม่ได้กันกรณี unmount ระหว่างสแกนพอดี)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

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

  const scanCandidates = useCallback(async () => {
    if (!fhKey) return; // เกณฑ์บังคับทั้ง 3 ข้อ (Hypergrowth VI) คำนวณจาก Finnhub /stock/metric ล้วน ๆ
    // token ใหม่ทุกครั้งที่เริ่มสแกน — ถ้ามีสแกนรอบก่อนหน้ายังค้างอยู่ (Promise ยังไม่ resolve)
    // isCurrent() ของรอบเก่าจะเป็น false ทันที ทำให้ setState ที่เหลือของรอบเก่ากลายเป็น no-op
    // แทนที่จะไปเขียนทับ state ของรอบใหม่ หรือยิง HTTP ต่อโดยไม่มีใครใช้ผลแล้ว
    const myToken = ++scanRef.current.token;
    const isCurrent = () => scanRef.current.token === myToken && isMountedRef.current;
    setLoading(true);
    const rotationPool = today.rotation;

    try {
      // เช็คก่อนเสมอว่าสัปดาห์นี้ (weekKey ปัจจุบัน) เคยสแกนอัตโนมัติจนได้ผลลัพธ์แล้วหรือยัง
      // (เก็บไว้ใน localStorage) — ถ้าเคยแล้ว ให้ใช้ชุดหุ้นเดิมที่ "ล็อก" ไว้ทันที โดยไม่ไล่สแกน
      // พูลทั้งหมดซ้ำอีกเลย (สแกนแค่ครั้งเดียวต่อสัปดาห์จริง ๆ ไม่มีปุ่มให้กดสแกนซ้ำเองแล้ว)
      const locked = await loadStore(WEEKLY_PICKS_STORE_KEY, null);
      if (!isCurrent()) return;
      if (locked && locked.weekKey === today.weekKey && Array.isArray(locked.symbols) && locked.symbols.length > 0) {
        setScanProgress({ done: locked.symbols.length, total: locked.symbols.length, found: locked.symbols.length });
        const cachedElig = locked.eligibility && typeof locked.eligibility === "object" ? locked.eligibility : {};
        setEligibilityMap((prev) => ({ ...prev, ...cachedElig }));
        // โหลด metric ของชุดหุ้นที่ล็อกไว้แล้วมาแสดงตัวเลขจริงบนการ์ด (mktCap ฯลฯ) — ไม่ต้องกรองซ้ำ
        // เพราะสัปดาห์นี้ผ่านเกณฑ์บังคับไปแล้วตอนสแกนครั้งแรก (แคชไว้ระดับ symbol ผ่าน fh-metric
        // อยู่แล้ว จึงไม่เปลืองโควตาซ้ำถ้ายังไม่หมดอายุ)
        const fundEntries = await Promise.all(
          locked.symbols.map(async (sym) => [sym, await fetchFundamentals(sym, fhKey).catch(() => null)])
        );
        if (!isCurrent()) return;
        setFundamentalsMap(Object.fromEntries(fundEntries));
        // ราคา/โลโก้/ชื่อบริษัท (Twelve Data, ใช้แสดงผลเฉย ๆ — ไม่เกี่ยวกับเกณฑ์บังคับข้อไหนเลย
        // เพราะ Thesis นี้ไม่สนความผันผวนของราคาตลาด) เฉพาะเมื่อมี Twelve Data API Key ไว้
        if (tdKey) {
          await loadSymbolsBatch(locked.symbols, DEFAULT_TIMEFRAME);
        }
        if (loadFundamentalsOnly) {
          await Promise.all(locked.symbols.map((sym) => loadFundamentalsOnly(sym)));
        }
        return;
      }

      // มี checkpoint ของสัปดาห์นี้ค้างอยู่ไหม (= รอบก่อนสแกนค้างไว้เพราะโควตาหมด) ถ้ามีก็สแกนต่อ
      // จากตำแหน่งเดิม พร้อมหิ้วรายชื่อที่ผ่านเกณฑ์มาแล้วติดมาด้วย ไม่ต้องเริ่มนับหนึ่งใหม่
      const checkpoint = await loadStore(SCAN_CHECKPOINT_KEY, null);
      if (!isCurrent()) return;
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
      // สะสมผลตรวจเกณฑ์บังคับ (Hypergrowth VI) "ของทุกตัวที่เช็กแล้ว" (ไม่ใช่แค่ตัวที่ผ่าน) เพราะ
      // eligibility/fund ของทุกสัญลักษณ์ใช้ต่อในการแสดงผล/จัดอันดับอยู่ดี พร้อมสืบทอดของเดิมจาก
      // checkpoint มาด้วย จะได้ไม่ต้องยิงซ้ำหลังสแกนต่อจากรอบก่อน
      const eligResults = resumable && checkpoint.eligibility && typeof checkpoint.eligibility === "object" ? { ...checkpoint.eligibility } : {};
      const fundResults = resumable && checkpoint.fund && typeof checkpoint.fund === "object" ? { ...checkpoint.fund } : {};

      // ไล่สแกนพูลทั้งก้อนด้วย Finnhub /stock/metric เพียงตัวเดียวต่อสัญลักษณ์ (เดิมยิง 4 endpoint —
      // metric + company-news + social-sentiment + profile2 — ตอนนี้เกณฑ์ทั้งหมดเป็นตัวเลขงบการเงิน/
      // มูลค่าล้วน ๆ จึงต้องการแค่ metric เท่านั้น สแกนเร็วขึ้นและประหยัดโควตากว่าเดิมมาก) เป็น "ก้อน"
      // (batch) ขนาดเท่าเพดานคำขอต่อนาทีที่ยิงผ่านได้จริง (ดู fundScanBatchSize) แล้วหยุดทันทีเมื่อ
      // พบผู้เข้าเกณฑ์บังคับครบ SCAN_BUFFER ตัว (Fast Stop) เพื่อประหยัดโควตา
      const chunkSize = fundScanBatchSize();
      outer:
      for (let i = cursor; i < rotationPool.length; i += chunkSize) {
        // สแกนรอบนี้ถูกแซงหน้าไปแล้ว (สแกนรอบใหม่เริ่มแล้ว หรือ component ถูกถอดไปแล้ว) — หยุด
        // ยิง HTTP ก้อนถัดไปทันที ไม่ต้องรอให้ลูปวิ่งจนจบพูลเปล่า ๆ (ตัดคำขอซ้ำซ้อนที่ไม่มีใครใช้)
        if (!isCurrent()) return;
        if (foundCount >= SCAN_BUFFER) break;
        cursor = i; // ตำแหน่งของก้อนที่กำลังจะยิง — ใช้เป็นจุดกลับมาสแกนต่อถ้าโควตาหมดตรงนี้

        const batchItems = rotationPool.slice(i, i + chunkSize);
        let quotaHit = false;
        const pairs = await Promise.all(
          batchItems.map(async (item) => {
            const sym = item.symbol;
            const fund = await fetchFundamentals(sym, fhKey).catch((e) => {
              if (e?.isQuotaExhausted) quotaHit = true;
              console.warn(`[Scanner] ${sym} metric ล้มเหลว`, describeApiErrorForLog(e));
              return null;
            });
            return { item, fund };
          })
        );

        for (const { item, fund } of pairs) {
          doneCount++;
          const sym = item.symbol;
          const elig = getHypergrowthEligibility(fund);
          fundResults[sym] = fund;

          if (elig.eligible) {
            eligResults[sym] = elig;
            shortlistSymbols.push(sym);
            foundCount++;
          }

          if (foundCount >= SCAN_BUFFER) {
            console.log(`[Scanner] พบหุ้นเข้าเกณฑ์บังคับครบ ${SCAN_BUFFER} ตัวแล้ว หยุดการสแกนทันที (ประหยัดโควตา API)`);
            break;
          }
        }

        // อัปเดต state ทุกครั้งที่ประมวลผลเสร็จหนึ่งก้อน — เดิมรอให้ลูปจบทั้งพูลก่อนถึงค่อย set
        // ทำให้ตลอดช่วงสแกน เห็นแต่แถบ "กำลังสแกน" ไม่มีการ์ดขึ้นเลย
        if (!isCurrent()) return; // ก้อนนี้ยิง HTTP เสร็จไปแล้วแต่สแกนรอบนี้ถูกแซงหน้าไปแล้วระหว่างรอ
        setEligibilityMap((prev) => ({ ...prev, ...eligResults }));
        setFundamentalsMap((prev) => ({ ...prev, ...fundResults }));
        setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });

        if (quotaHit && foundCount < SCAN_BUFFER) {
          console.warn("[Scanner] พักการสแกน: โควตา Finnhub หมด — บันทึกจุดพักไว้แล้ว จะสแกนต่อเองในรอบถัดไป");
          stoppedByQuota = true;
          break outer;
        }
        if (foundCount >= SCAN_BUFFER) break outer;
        cursor = i + chunkSize; // ก้อนนี้สำเร็จแล้ว เลื่อนจุดกลับมาสแกนต่อไปข้างหน้า
        setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });
      }
      if (!isCurrent()) return;
      setScanProgress({ done: doneCount, total: rotationPool.length, found: foundCount });
      setEligibilityMap((prev) => ({ ...prev, ...eligResults }));
      setFundamentalsMap((prev) => ({ ...prev, ...fundResults }));

      // ราคา/โลโก้/ชื่อบริษัท (Twelve Data, ข้อมูลแสดงผลเฉย ๆ) เฉพาะหุ้นที่ "ผ่านเกณฑ์บังคับแล้ว
      // เท่านั้น" เพื่อแสดงผลบนการ์ด — ไม่มีผลต่อการคัดกรอง/จัดอันดับใด ๆ
      if (tdKey && shortlistSymbols.length > 0) {
        await loadSymbolsBatch(shortlistSymbols, DEFAULT_TIMEFRAME);
      }
      if (loadFundamentalsOnly && shortlistSymbols.length > 0) {
        await Promise.all(shortlistSymbols.map((sym) => loadFundamentalsOnly(sym)));
      }

      if (stoppedByQuota) {
        // ยังสแกนไม่จบ — บันทึกเป็น "จุดพัก" ไม่ใช่ผลสุดท้าย เพื่อไม่ให้ชุดหุ้นที่ยังไม่ครบถูก
        // ล็อกค้างไว้ทั้งสัปดาห์ ครั้งหน้าที่เปิดแอป (โควตารอบใหม่) จะสแกนต่อจากตรงนี้เอง
        if (isCurrent()) setQuotaPaused(true);
        await saveStore(SCAN_CHECKPOINT_KEY, {
          weekKey: today.weekKey,
          cursor,
          done: doneCount,
          shortlist: shortlistSymbols,
          eligibility: eligResults,
          fund: fundResults,
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
        // แสดงผลได้ทันทีโดยไม่ต้องคำนวณเกณฑ์ซ้ำ (ตัวเลขยังรีเฟรชได้ผ่านแคช fh-metric ตามอายุแคชปกติ)
        eligibility: Object.fromEntries(shortlistSymbols.filter((sym) => eligResults[sym]).map((sym) => [sym, eligResults[sym]])),
        savedAt: Date.now(),
      });
      // สแกนจบสมบูรณ์แล้ว ไม่ต้องเก็บจุดพักไว้อีก
      try { localStorage.removeItem(SCAN_CHECKPOINT_KEY); } catch {}
    } finally {
      // ถ้าสแกนรอบนี้ถูกแซงหน้าไปแล้ว รอบใหม่จะเป็นคนคุม setLoading เอง — ไม่ใช่หน้าที่ของรอบเก่า
      if (isCurrent()) setLoading(false);
    }
  }, [tdKey, fhKey, today, loadSymbolsBatch, loadFundamentalsOnly]);

  useEffect(() => {
    // รอให้พูลหุ้นทั่วโลก (ดู fetchGlobalStockUniverse) โหลดเสร็จก่อนเสมอ (หรือ fail-open
    // กลับไปใช้ TRENDING_UNIVERSE ถ้าโหลดไม่สำเร็จ) ก่อนเริ่มสแกน — กันไม่ให้สแกนซ้ำสองรอบ
    // ด้วยพูลคนละขนาดกัน (รอบแรกจากพูลเล็กแล้วรอบสองจากพูลใหญ่ที่โหลดมาทีหลัง)
    if (!universeReady) return;
    scanCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today.weekKey, tdKey, fhKey, universeReady]);

  // ตารางค้นหา metadata ของสัญลักษณ์ (ประเทศ/sector/catalyst — เพื่อแสดงผลเฉย ๆ ไม่มีผลต่อเกณฑ์)
  // แบบ O(1) — สร้างครั้งเดียวต่อพูล
  const poolIndex = useMemo(() => {
    const m = new Map();
    for (const item of universe) m.set(item.symbol, item);
    return m;
  }, [universe]);

  // เดิม memo นี้ไล่ลูปพูลทั้งก้อน (หลักพันตัว) ใหม่ทุกครั้งที่ dataMap/eligibilityMap เปลี่ยน
  // ซึ่งเกิดถี่มากระหว่างสแกน = งานเปล่าหลักแสนรอบต่อการสแกนหนึ่งครั้ง ตอนนี้วนเฉพาะสัญลักษณ์
  // ที่ผ่านเกณฑ์จริง (ไม่เกิน SCAN_BUFFER ตัว) แล้วเปิดตาราง metadata เอา
  const recommended = useMemo(() => {
    const candidates = [];
    for (const symbol of Object.keys(eligibilityMap)) {
      const elig = eligibilityMap[symbol];
      if (!elig) continue;
      const item = poolIndex.get(symbol) || { symbol, country: null, sector: null, catalyst: null };
      const fundamentals = fundamentalsMap[symbol];
      const entry = dataMap[symbol];
      const mktCapB = ((pick(fundamentals, ["marketCapitalization"]) || entry?.profile?.marketCapitalization || 0) * 1e6) / 1e9;
      const countryMeta = getCountryMeta(item.country);
      candidates.push({
        ...item,
        growth: elig.growth,
        growthRate: elig.growthRate,
        growthBasisLabel: elig.growthBasisLabel,
        growthBasisMetric: elig.growthBasisMetric,
        valuation: elig.valuation,
        impliedCAGR: elig.impliedCAGR,
        // จัดอันดับด้วยผลตอบแทนทบต้นโดยประมาณ (Implied CAGR) โดยตรง — เป็นตัวแทนของ Risk-Reward
        // ที่คำนวณจากตัวเลขล้วน ๆ อยู่แล้ว (ดูรายละเอียดสูตรใน recommendationScan.js)
        score: elig.impliedCAGR ?? 0,
        mktCapB,
        capTier: getCapTier(mktCapB),
        countryMeta,
        region: countryMeta.region,
        quote: entry?.quote,
        profile: entry?.profile,
      });
    }

    // เรียงจาก "ผลตอบแทนทบต้นโดยประมาณสูงสุด" ก่อนเสมอ — ยิ่งสูง ยิ่งเข้าข่าย Risk-Reward ไม่สมมาตร
    // ("1 บาทลุ้น 100 บาท") ตามที่กำหนด
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, WEEKLY_PICK_COUNT);
  }, [poolIndex, dataMap, fundamentalsMap, eligibilityMap]);

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-zinc-900 to-emerald-500/10 border border-amber-500/30 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
            <Zap className="fill-amber-400" size={18} />
            <span>หุ้นแนะนำประจำสัปดาห์ 🚀 Hypergrowth VI ({WEEKLY_PICK_COUNT} ตัว)</span>
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            เกณฑ์บังคับครบ 3 ข้อ (ตัวเลขล้วน ไม่มีข่าว/โซเชียล/sector-keyword/ความผันผวนราคา):
            Disruptive Growth (รายได้หรือกำไรโต ≥ {MIN_DISRUPTIVE_GROWTH_PCT}%/ปี) + Margin of Safety
            (PEG/PSG ≤ {MAX_VALUATION_RATIO.toFixed(2)}x จากเกณฑ์ยุติธรรม {FAIR_VALUE_RATIO.toFixed(1)}x)
            + เป้าหมายผลตอบแทนทบต้นโดยประมาณ ≥ {MIN_TARGET_CAGR_PCT}%/ปี ใน {REVALUATION_YEARS} ปี
            จากพูลหุ้นทั่วโลก ~{GLOBAL_UNIVERSE_TARGET_SIZE.toLocaleString()} ตัว จัดอันดับด้วยผลตอบแทน
            ทบต้นโดยประมาณสูงสุดก่อน
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
            ต้องตั้งค่า <strong>Finnhub API Key</strong> ก่อน (ใช้ดึงงบการเงิน/มูลค่า /stock/metric
            ซึ่งเป็นแหล่งข้อมูลเดียวของเกณฑ์บังคับทั้ง 3 ข้อ) จึงจะสแกนเพื่อหาหุ้นแนะนำประจำสัปดาห์ได้
            — ตั้งค่าได้ที่เมนู ⚙ มุมขวาบน
          </span>
        </div>
      )}

      {fhKey && !tdKey && (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-2.5 text-[11px] text-zinc-400 flex items-start gap-2">
          <span>ℹ️</span>
          <span>
            ยังไม่ได้ตั้งค่า <strong>Twelve Data API Key</strong> — ยังสแกนเกณฑ์บังคับทั้ง 3 ข้อได้
            ตามปกติ (ไม่ต้องใช้ Twelve Data เลย) แต่จะไม่มีราคา/โลโก้บนการ์ด
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
          ⏸️ พักการสแกนไว้ชั่วคราว เพราะใช้โควตา Finnhub ครบตามที่ตั้งไว้แล้ว —
          สแกนไปได้ {scanProgress.done}/{scanProgress.total} ตัว พบผู้เข้าเกณฑ์ {scanProgress.found}/{SCAN_BUFFER} ตัว
          <div className="text-blue-300/70 mt-1">
            ระบบบันทึกจุดที่ค้างไว้แล้ว เปิดแอปอีกครั้งจะสแกนต่อจากตรงนี้เอง ไม่ต้องเริ่มใหม่ —
            หุ้นที่ผ่านเกณฑ์แล้วด้านล่างยังดูได้ตามปกติ (ถ้าต้องการให้จบเร็วขึ้น ปรับเพดานโควตาในหน้าตั้งค่า ⚙ ให้ตรงกับ Plan ที่ใช้จริง)
          </div>
        </div>
      )}

      {!loading && recommended.length === 0 && (
        <div className="text-xs text-zinc-500 text-center py-6">
          {fhKey
            ? "ยังไม่พบหุ้นที่ผ่านเกณฑ์ Hypergrowth VI ครบทั้ง 3 ข้อในสัปดาห์นี้"
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
