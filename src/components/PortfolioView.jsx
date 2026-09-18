import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendTxLedgerEntries } from "../api/transactionLedger.js";
import { CACHE_TTL_MS } from "../api/priceCache.js";
import { extractPortfolioFromImage, fetchUsdThbRate, loadStore, saveStore } from "../api/quotaEngine.js";
import { fetchQuoteBalanced } from "../api/priceSeries.js";
import { AlertTriangle, Briefcase, ImageIcon, Plus, RefreshCw, Trash2 } from "./icons.jsx";
import { PortfolioGrowthChart } from "./PortfolioGrowthChart.jsx";
import { fmtPct, fmtPrice, getStockName } from "../utils/formatters.js";
import { StockLogo } from "./StockLogo.jsx";
import { ImportPortfolioModal } from "./ImportPortfolioModal.jsx";

export const PortfolioView = memo(function PortfolioView({ tdKey, fhKey, geminiKey, dataMap, loadSymbol, refreshQuoteOnly }) {
  const [portfolios, setPortfolios] = useState([]);
  const [activePortId, setActivePortId] = useState("");
  const [newPortName, setNewPortName] = useState("");
  const [showNewPortInput, setShowNewPortInput] = useState(false);

  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importRows, setImportRows] = useState([]);
  const importFileRef = useRef(null);

  const [sortField, setSortField] = useState("currVal");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedSymbol, setExpandedSymbol] = useState(null);

  // เงินสด (Cash) — เป็นก้อนเดียวรวมกันทั้งหมด แยกจากทุกพอร์ต ไม่ผูกกับ portfolio ใดพอร์ตหนึ่ง
  const [cashAmount, setCashAmount] = useState(0);
  const [cashAmountInput, setCashAmountInput] = useState("0");
  const [cashIncluded, setCashIncluded] = useState(false);

  // สกุลเงินที่แสดง (USD/THB) และอัตราแลกเปลี่ยนปัจจุบัน
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [usdThbRate, setUsdThbRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateUpdatedAt, setRateUpdatedAt] = useState(null);
  const [rateError, setRateError] = useState("");

  // เป้าหมายมูลค่าพอร์ต (เก็บภายในเป็น USD เสมอ)
  const [portfolioGoal, setPortfolioGoal] = useState(0);
  const [goalInput, setGoalInput] = useState("");

  // เป้าหมายมูลค่าแยกรายพอร์ต (เก็บเป็น map { [portfolioId]: usdGoal })
  const [portfolioGoals, setPortfolioGoals] = useState({});
  const [portGoalInput, setPortGoalInput] = useState("");

  const refreshExchangeRate = useCallback(async () => {
    setRateLoading(true);
    setRateError("");
    const result = await fetchUsdThbRate();
    if (result) {
      setUsdThbRate(result.rate);
      setRateUpdatedAt(result.updatedAt);
      saveStore("us-dash-usdthb-rate-v1", result);
    } else {
      setRateError("ดึงอัตราแลกเปลี่ยนล่าสุดไม่สำเร็จ ใช้ค่าล่าสุดที่มีอยู่แทน");
    }
    setRateLoading(false);
  }, []);

  const fmtMoney = useCallback((usdVal) => {
    if (usdVal == null || isNaN(usdVal)) return "—";
    if (displayCurrency === "THB") {
      if (!usdThbRate) return `≈$${fmtPrice(usdVal)}`;
      const thb = usdVal * usdThbRate;
      return `฿${thb.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
    }
    return `$${fmtPrice(usdVal)}`;
  }, [displayCurrency, usdThbRate]);

  const toggleCurrency = (target) => {
    const next = target || (displayCurrency === "USD" ? "THB" : "USD");
    if (next === displayCurrency) return;
    setDisplayCurrency(next);
    saveStore("us-dash-currency-v1", next);
    if (portfolioGoal > 0) {
      const displayVal = next === "THB" && usdThbRate ? portfolioGoal * usdThbRate : portfolioGoal;
      setGoalInput(next === "THB" ? String(Math.round(displayVal)) : displayVal.toFixed(2));
    }
  };

  const handleGoalCommit = () => {
    const val = parseFloat(goalInput);
    let usdVal = Number.isFinite(val) && val > 0 ? val : 0;
    if (displayCurrency === "THB" && usdThbRate) {
      usdVal = usdVal / usdThbRate;
    }
    setPortfolioGoal(usdVal);
    saveStore("us-dash-portfolio-goal-v1", usdVal);
    if (usdVal > 0) {
      const displayVal = displayCurrency === "THB" && usdThbRate ? usdVal * usdThbRate : usdVal;
      setGoalInput(displayCurrency === "THB" ? String(Math.round(displayVal)) : displayVal.toFixed(2));
    } else {
      setGoalInput("");
    }
  };

  const handlePortGoalCommit = () => {
    const val = parseFloat(portGoalInput);
    let usdVal = Number.isFinite(val) && val > 0 ? val : 0;
    if (displayCurrency === "THB" && usdThbRate) {
      usdVal = usdVal / usdThbRate;
    }
    const updatedGoals = { ...portfolioGoals, [activePort.id]: usdVal };
    setPortfolioGoals(updatedGoals);
    saveStore("us-dash-portfolio-goals-v1", updatedGoals);
  };

  // ซิงก์ค่าที่แสดงในช่องเป้าหมายรายพอร์ตเมื่อสลับพอร์ต / สลับสกุลเงิน / เรตเปลี่ยน (ย้ายไปไว้หลัง activePort ถูกประกาศ ด้านล่าง)

  useEffect(() => {
    (async () => {
      const savedCurrency = await loadStore("us-dash-currency-v1", "USD");
      setDisplayCurrency(savedCurrency === "THB" ? "THB" : "USD");

      const savedGoal = await loadStore("us-dash-portfolio-goal-v1", 0);
      const g = Number(savedGoal);
      const goalUsd = Number.isFinite(g) && g > 0 ? g : 0;
      setPortfolioGoal(goalUsd);

      const savedPortGoals = await loadStore("us-dash-portfolio-goals-v1", {});
      setPortfolioGoals(savedPortGoals && typeof savedPortGoals === "object" ? savedPortGoals : {});

      const cachedRate = await loadStore("us-dash-usdthb-rate-v1", null);
      if (cachedRate?.rate) {
        setUsdThbRate(cachedRate.rate);
        setRateUpdatedAt(cachedRate.updatedAt);
        if (goalUsd > 0) {
          const displayVal = savedCurrency === "THB" ? goalUsd * cachedRate.rate : goalUsd;
          setGoalInput(savedCurrency === "THB" ? String(Math.round(displayVal)) : displayVal.toFixed(2));
        }
      } else if (goalUsd > 0) {
        setGoalInput(goalUsd.toFixed(2));
      }

      refreshExchangeRate();
    })();
  }, []);

  useEffect(() => {
    (async () => {
      let ports = await loadStore("us-dash-portfolios-v3", null);
      if (!ports || ports.length === 0) {
        const legacy = await loadStore("us-dash-portfolio-v2", []);
        ports = [
          {
            id: "port-" + Date.now(),
            name: "พอร์ตหลัก (Main Portfolio)",
            items: Array.isArray(legacy) ? legacy : []
          }
        ];
        saveStore("us-dash-portfolios-v3", ports);
      }
      setPortfolios(ports);
      if (ports.length > 0) {
        setActivePortId(ports[0].id);
      }

      const savedCash = await loadStore("us-dash-cash-v1", { amount: 0, included: false });
      const amt = Number(savedCash?.amount);
      setCashAmount(Number.isFinite(amt) ? amt : 0);
      setCashAmountInput(Number.isFinite(amt) ? String(amt) : "0");
      setCashIncluded(!!savedCash?.included);
    })();
  }, []);

  const savePortfolios = (updated) => {
    setPortfolios(updated);
    saveStore("us-dash-portfolios-v3", updated);
  };

  const saveCash = (amount, included) => {
    setCashAmount(amount);
    setCashIncluded(included);
    saveStore("us-dash-cash-v1", { amount, included });
  };

  const handleCashAmountCommit = () => {
    const val = parseFloat(cashAmountInput);
    const amount = Number.isFinite(val) ? val : 0;
    setCashAmountInput(String(amount));
    saveCash(amount, cashIncluded);
  };

  const toggleCashIncluded = () => {
    saveCash(cashAmount, !cashIncluded);
  };

  const activePort = useMemo(() => {
    return portfolios.find((p) => p.id === activePortId) || portfolios[0] || { id: "def", name: "Default", items: [] };
  }, [portfolios, activePortId]);

  // ซิงก์ค่าที่แสดงในช่องเป้าหมายรายพอร์ตเมื่อสลับพอร์ต / สลับสกุลเงิน / เรตเปลี่ยน
  useEffect(() => {
    const usdVal = portfolioGoals[activePort.id] || 0;
    if (usdVal > 0) {
      const displayVal = displayCurrency === "THB" && usdThbRate ? usdVal * usdThbRate : usdVal;
      setPortGoalInput(displayCurrency === "THB" ? String(Math.round(displayVal)) : displayVal.toFixed(2));
    } else {
      setPortGoalInput("");
    }
  }, [activePort.id, portfolioGoals, displayCurrency, usdThbRate]);

  const portfolio = activePort.items || [];

  const updateActiveItems = (updatedItems) => {
    const updatedPorts = portfolios.map((p) => {
      if (p.id === activePort.id) {
        return { ...p, items: updatedItems };
      }
      return p;
    });
    savePortfolios(updatedPorts);
  };

  const resetImportState = () => {
    setImportPreview(null);
    setImportLoading(false);
    setImportError("");
    setImportRows([]);
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    resetImportState();
  };

  const handleImportButtonClick = () => {
    if (!geminiKey || !geminiKey.trim()) {
      alert("กรุณาตั้งค่า Gemini API Key ก่อน (เมนู ⚙ มุมขวาบน) เพื่อใช้ฟีเจอร์อ่านรูปพอร์ตอัตโนมัติ");
      return;
    }
    setShowImportModal(true);
    setTimeout(() => importFileRef.current?.click(), 0);
  };

  const handleImportFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setImportError("");
    setImportRows([]);
    setImportLoading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if (!match) {
        setImportError("ไม่สามารถอ่านไฟล์รูปภาพนี้ได้");
        setImportLoading(false);
        return;
      }
      const mediaType = match[1];
      const base64Data = match[2];
      setImportPreview(dataUrl);

      try {
        const { rows, truncated } = await extractPortfolioFromImage(base64Data, mediaType, geminiKey.trim());
        if (rows.length === 0) {
          setImportError("ไม่พบรายการซื้อขายหุ้นในภาพนี้ ลองใช้ภาพที่เห็นชื่อหุ้นและระบุได้ว่าเป็นการซื้อหรือขายชัดเจนกว่านี้");
        } else if (truncated) {
          setImportError(
            `อ่านได้ ${rows.length} รายการ แต่ AI อาจตัดจบก่อนอ่านครบทุกแถวในภาพ (ข้อความยาวเกินไป) — ตรวจสอบด้านล่างว่าครบตามภาพหรือไม่ ถ้าไม่ครบลองครอปภาพให้เหลือรายการน้อยลงแล้วอัปโหลดเพิ่มเติมทีหลัง`
          );
        }
        setImportRows(rows.map((r) => ({ ...r, include: true })));
      } catch (err) {
        setImportError(err.message || "เกิดข้อผิดพลาดระหว่างอ่านภาพ");
      } finally {
        setImportLoading(false);
      }
    };
    reader.onerror = () => {
      setImportError("ไม่สามารถอ่านไฟล์รูปภาพนี้ได้");
      setImportLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const updateImportRow = (idx, patch) => {
    setImportRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const merged = { ...r, ...patch };
      // ถ้ามียอดรวมของรายการ (amount) อยู่แล้ว และผู้ใช้เพิ่งกรอก/แก้จำนวนหุ้น แต่ยังไม่มีราคาต่อหุ้น
      // ให้คำนวณราคาต่อหุ้นให้อัตโนมัติจาก amount / shares
      if (
        "shares" in patch &&
        Number.isFinite(merged.amount) && merged.amount > 0 &&
        Number.isFinite(merged.shares) && merged.shares > 0 &&
        (merged.price === null || merged.price === undefined || Number.isNaN(merged.price))
      ) {
        merged.price = Math.round((merged.amount / merged.shares) * 10000) / 10000;
      }
      return merged;
    }));
  };

  const removeImportRow = (idx) => {
    setImportRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const confirmImportRows = () => {
    const missingShares = importRows.filter((r) => r.include && r.symbol && !(Number.isFinite(r.shares) && r.shares > 0));
    const toApply = importRows.filter(
      (r) => r.include && r.symbol && Number.isFinite(r.shares) && r.shares > 0
    );
    if (toApply.length === 0) {
      alert("ไม่มีรายการที่พร้อมนำเข้า กรุณากรอกจำนวนหุ้นให้ครบทุกแถวก่อนยืนยัน");
      return;
    }
    if (missingShares.length > 0) {
      const proceed = confirm(
        `มี ${missingShares.length} รายการ (${missingShares.map((r) => r.symbol).join(", ")}) ที่ยังไม่ได้กรอกจำนวนหุ้น จะถูกข้ามไปก่อน ต้องการยืนยันเฉพาะรายการที่กรอกครบแล้วหรือไม่?`
      );
      if (!proceed) return;
    }

    const skippedSells = [];
    let updated = [...portfolio];
    const ledgerEntries = [];

    toApply.forEach((row) => {
      const s = row.symbol.toUpperCase().trim();
      const numShares = row.shares;
      const price = Number.isFinite(row.price) ? row.price : null;
      const txDate = row.date || new Date().toISOString().slice(0, 10);
      const existingIndex = updated.findIndex((item) => item.symbol === s);

      if (row.action === "SELL") {
        // ตัดขาย/Trim หุ้นที่มีอยู่แล้วในพอร์ตโดยอัตโนมัติ
        if (existingIndex < 0) {
          skippedSells.push(s);
          return;
        }
        const existing = updated[existingIndex];
        const sellShares = Math.min(numShares, existing.shares);
        if (Math.abs(sellShares - existing.shares) < 1e-6) {
          updated.splice(existingIndex, 1);
        } else {
          updated[existingIndex] = {
            ...existing,
            shares: existing.shares - sellShares,
            lastTxDate: txDate
          };
        }
        // บันทึกลงประวัติการทำรายการจริง (ใช้สร้างกราฟการเติบโตของมูลค่าพอร์ตย้อนหลัง)
        ledgerEntries.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          symbol: s,
          type: "SELL",
          shares: sellShares,
          price: price != null ? price : existing.avgCost,
          date: txDate
        });
      } else {
        // ซื้อเพิ่ม/เพิ่มหุ้นใหม่เข้าพอร์ตโดยอัตโนมัติ
        let buyPrice;
        if (existingIndex >= 0) {
          const existing = updated[existingIndex];
          buyPrice = price != null ? price : existing.avgCost;
          const oldTotalCost = existing.shares * existing.avgCost;
          const newBuyCost = numShares * buyPrice;
          const newTotalShares = existing.shares + numShares;
          const newAvgCost = (oldTotalCost + newBuyCost) / newTotalShares;
          updated[existingIndex] = {
            ...existing,
            shares: newTotalShares,
            avgCost: newAvgCost,
            lastTxDate: txDate
          };
        } else {
          buyPrice = price != null ? price : 0;
          updated.push({
            symbol: s,
            shares: numShares,
            avgCost: buyPrice,
            targetPct: 0,
            lastTxDate: txDate
          });
        }
        // บันทึกลงประวัติการทำรายการจริง (ใช้สร้างกราฟการเติบโตของมูลค่าพอร์ตย้อนหลัง)
        ledgerEntries.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          symbol: s,
          type: "BUY",
          shares: numShares,
          price: buyPrice,
          date: txDate
        });
      }
    });

    appendTxLedgerEntries(ledgerEntries);
    updateActiveItems(updated);
    if (tdKey) toApply.forEach((row) => loadSymbol(row.symbol.toUpperCase().trim(), true));

    if (skippedSells.length > 0) {
      alert(`ข้ามรายการขายของ ${skippedSells.join(", ")} เนื่องจากไม่พบหุ้นนี้ในพอร์ต "${activePort.name}"`);
    }

    closeImportModal();
  };

  const handleCreatePortfolio = (e) => {
    e.preventDefault();
    const name = newPortName.trim();
    if (!name) return;

    const newPort = {
      id: "port-" + Date.now(),
      name,
      items: []
    };
    const updated = [...portfolios, newPort];
    savePortfolios(updated);
    setActivePortId(newPort.id);
    setNewPortName("");
    setShowNewPortInput(false);
  };

  const handleDeletePortfolio = (portId) => {
    if (portfolios.length <= 1) {
      alert("ไม่สามารถลบพอร์ตทั้งหมดได้ ต้องมีอย่างน้อย 1 พอร์ตในระบบ");
      return;
    }
    const target = portfolios.find((p) => p.id === portId);
    if (confirm(`คุณต้องการลบพอร์ต "${target?.name}" ออกใช่หรือไม่?`)) {
      const updated = portfolios.filter((p) => p.id !== portId);
      savePortfolios(updated);
      if (activePortId === portId) {
        setActivePortId(updated[0].id);
      }
      if (portfolioGoals[portId] != null) {
        const nextGoals = { ...portfolioGoals };
        delete nextGoals[portId];
        setPortfolioGoals(nextGoals);
        saveStore("us-dash-portfolio-goals-v1", nextGoals);
      }
    }
  };

  // จุดบอดเดิมของหน้าพอร์ต: ไม่ว่าจะมีกี่หุ้นในพอร์ต (รวมทุกพอร์ตแล้ว unique) โค้ดนี้ยิง
  // loadSymbol(s, true) "เต็มรูปแบบ" ให้ทุกตัวพร้อมกันผ่าน Promise.all — แต่ loadSymbol เต็มรูปแบบ
  // จะไปเข้าคิว Twelve Data (tdQueue) ที่จำกัดจังหวะยิงไว้ที่ ~7.7 วินาที/ครั้งบนแพ็กเกจฟรี
  // (ดู tdMinIntervalMs) เพราะ Promise.all ไม่ได้ทำให้ยิงพร้อมกันจริง แค่ "ส่งเข้าคิวพร้อมกัน"
  // ทุกตัวก็ยังต้องรอคิวเรียงตามลำดับอยู่ดี ผลคือถ้าพอร์ตมี 10-15 ตัว หน้าพอร์ตจะค้างโหลดราคา
  // นานเป็นนาที ทั้งที่แอปนี้มีระบบ "จุดสมดุลภาระ Finnhub/Twelve Data" (fetchQuoteBalanced /
  // refreshQuoteOnly) อยู่แล้วสำหรับหน้า Watchlist (ปุ่ม "อัปเดตทั้งหมด") แต่หน้าพอร์ตไม่เคยถูก
  // เชื่อมให้ใช้ระบบเดียวกันนี้เลย ตอนนี้ใช้ตรรกะเดียวกับ refreshAll ของ Watchlist:
  //   - แท่งราคา/อินดิเคเตอร์ของสัญลักษณ์นั้นยังสดอยู่ (ไม่เกิน CACHE_TTL_MS) และมี Finnhub key
  //     → ใช้ refreshQuoteOnly (ยิง Finnhub /quote เบา ๆ ไม่แตะโควตา/คิว Twelve Data เลย)
  //   - ไม่งั้น (ยังไม่เคยโหลด หรือแท่งราคาเก่าเกินไป) → ต้องยิง Twelve Data เต็มรูปแบบเหมือนเดิม
  //     เพราะเป็นจุดเดียวที่ให้ข้อมูลแท่งราคาย้อนหลังได้จริง
  const refreshPortfolioQuotes = useCallback(async () => {
    if (!tdKey) return;
    const allSymbols = [...new Set(portfolios.flatMap((p) => (p.items || []).map((item) => item.symbol)))];
    if (allSymbols.length === 0) return;

    setLoadingQuotes(true);
    const fh = (fhKey || "").trim();
    await Promise.all(allSymbols.map((s) => {
      const cached = dataMap[s];
      const seriesFresh = cached && cached.series && cached.series.length >= 20 &&
        cached.cachedAt && (Date.now() - cached.cachedAt) < CACHE_TTL_MS;
      if (fh && seriesFresh && refreshQuoteOnly) {
        return refreshQuoteOnly(s);
      }
      return loadSymbol(s, true);
    }));
    setLoadingQuotes(false);
  }, [portfolios, tdKey, fhKey, dataMap, loadSymbol, refreshQuoteOnly]);

  useEffect(() => {
    if (portfolios.length > 0 && tdKey) {
      refreshPortfolioQuotes();
    }
  }, [portfolios.length, tdKey]);

  const updateTargetPct = (sym, newPct) => {
    const val = parseFloat(newPct);
    const updated = portfolio.map((item) => {
      if (item.symbol === sym) {
        return { ...item, targetPct: !isNaN(val) && val >= 0 ? val : 0 };
      }
      return item;
    });
    updateActiveItems(updated);
  };

  const deletePosition = (sym) => {
    if (confirm(`คุณต้องการลบหุ้น ${sym} ออกจากพอร์ต "${activePort.name}" ใช่หรือไม่?`)) {
      const existing = portfolio.find((item) => item.symbol === sym);
      if (existing && existing.shares > 0) {
        // บันทึกเป็นรายการ "ขายทั้งหมด" ลงประวัติการทำรายการ (ใช้สร้างกราฟการเติบโตของมูลค่าพอร์ตย้อนหลัง)
        const quote = dataMap[sym]?.quote;
        const currPrice = quote?.close ? parseFloat(quote.close) : existing.avgCost;
        appendTxLedgerEntries([
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            symbol: sym,
            type: "SELL",
            shares: existing.shares,
            price: currPrice,
            date: new Date().toISOString().slice(0, 10)
          }
        ]);
      }
      const updated = portfolio.filter((item) => item.symbol !== sym);
      updateActiveItems(updated);
    }
  };

  const totalPortfolioVal = useMemo(() => {
    return portfolio.reduce((acc, item) => {
      const quote = dataMap[item.symbol]?.quote;
      const currPrice = quote?.close ? parseFloat(quote.close) : null;
      const currVal = currPrice != null ? item.shares * currPrice : item.shares * item.avgCost;
      return acc + currVal;
    }, 0);
  }, [portfolio, dataMap]);

  // มูลค่ารวมทุกพอร์ต (ทุกพอร์ตทั้งหมด ไม่ใช่แค่พอร์ตที่กำลังเปิดดู) — ใช้เป็นฐานสำหรับรวมเงินสด
  const totalAllPortfoliosVal = useMemo(() => {
    return portfolios.reduce((acc, p) => {
      const items = p.items || [];
      const val = items.reduce((iAcc, item) => {
        const quote = dataMap[item.symbol]?.quote;
        const currPrice = quote?.close ? parseFloat(quote.close) : null;
        const currVal = currPrice != null ? item.shares * currPrice : item.shares * item.avgCost;
        return iAcc + currVal;
      }, 0);
      return acc + val;
    }, 0);
  }, [portfolios, dataMap]);

  const grandTotalWithCash = totalAllPortfoliosVal + (cashIncluded ? cashAmount : 0);

  const goalProgressPct = portfolioGoal > 0 ? Math.min(100, (grandTotalWithCash / portfolioGoal) * 100) : 0;

  const processedPortfolio = useMemo(() => {
    return portfolio.map((item) => {
      const quote = dataMap[item.symbol]?.quote;
      const currPrice = quote?.close ? parseFloat(quote.close) : null;
      const totalCost = item.shares * item.avgCost;
      const currVal = currPrice != null ? item.shares * currPrice : totalCost;
      const pl = currPrice != null ? currVal - totalCost : 0;
      const plPct = currPrice != null && totalCost > 0 ? (pl / totalCost) * 100 : 0;

      const targetPct = item.targetPct != null ? parseFloat(item.targetPct) : 0;
      const actualPct = totalPortfolioVal > 0 ? (currVal / totalPortfolioVal) * 100 : 0;
      const maxAllowedVal = totalPortfolioVal * (targetPct / 100);
      const excessVal = maxAllowedVal > 0 ? currVal - maxAllowedVal : 0;
      const excessPct = actualPct - targetPct;
      const isOver = targetPct > 0 && excessVal > 0.01;

      return {
        ...item,
        currPrice,
        totalCost,
        currVal,
        pl,
        plPct,
        targetPct,
        actualPct,
        maxAllowedVal,
        excessVal,
        excessPct,
        isOver
      };
    });
  }, [portfolio, dataMap, totalPortfolioVal]);

  const sortedPortfolio = useMemo(() => {
    return [...processedPortfolio].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA ?? 0) - (valB ?? 0) : (valB ?? 0) - (valA ?? 0);
    });
  }, [processedPortfolio, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const summary = useMemo(() => {
    let totalCost = 0;
    let totalCurrentVal = 0;
    let totalTargetPctAllocated = 0;
    let totalOverAllocatedCount = 0;

    processedPortfolio.forEach((item) => {
      totalCost += item.totalCost;
      totalCurrentVal += item.currVal;
      totalTargetPctAllocated += item.targetPct;
      if (item.isOver) totalOverAllocatedCount++;
    });

    const totalPL = totalCurrentVal - totalCost;
    const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;

    return { totalCost, totalCurrentVal, totalPL, totalPLPct, totalTargetPctAllocated, totalOverAllocatedCount };
  }, [processedPortfolio]);

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 mr-1">
            <Briefcase className="text-blue-400" size={16} /> เลือกพอร์ตลงทุน:
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {portfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePortId(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-2 ${
                  p.id === activePort.id
                    ? "bg-blue-600 text-white font-bold shadow-sm"
                    : "bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                }`}
              >
                <span>{p.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-900/60 text-zinc-300">
                  {p.items?.length || 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!showNewPortInput ? (
            <button
              onClick={() => setShowNewPortInput(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium transition"
            >
              <Plus size={14} /> สร้างพอร์ตใหม่
            </button>
          ) : (
            <form onSubmit={handleCreatePortfolio} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="ชื่อพอร์ต เช่น พอร์ตเกษียณ"
                value={newPortName}
                onChange={(e) => setNewPortName(e.target.value)}
                className="bg-zinc-950 border border-emerald-500/50 rounded px-2.5 py-1 text-xs text-zinc-100 font-mono w-44 focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500"
              >
                สร้าง
              </button>
              <button
                type="button"
                onClick={() => { setShowNewPortInput(false); setNewPortName(""); }}
                className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 text-xs hover:text-zinc-200"
              >
                ยกเลิก
              </button>
            </form>
          )}

          {portfolios.length > 1 && (
            <button
              onClick={() => handleDeletePortfolio(activePort.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 text-xs transition"
              title="ลบพอร์ตปัจจุบัน"
            >
              <Trash2 size={13} /> ลบพอร์ต
            </button>
          )}
        </div>
      </div>

      <div className="bg-zinc-900 border border-emerald-500/20 rounded-lg p-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <span>💵</span> เงินสด (รวมทุกพอร์ต):
          </span>
          <input
            type="number"
            step="any"
            value={cashAmountInput}
            onChange={(e) => setCashAmountInput(e.target.value)}
            onBlur={handleCashAmountCommit}
            placeholder="0"
            className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-emerald-300"
          />
          <button
            onClick={handleCashAmountCommit}
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition"
          >
            บันทึก
          </button>
          <span className="text-[10px] text-zinc-500">
            เงินสดเป็นก้อนเดียวรวมกันของทุกพอร์ต ไม่ได้แยกตามพอร์ตใดพอร์ตหนึ่ง
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] text-zinc-400">รวมเงินสดกับมูลค่าพอร์ตทั้งหมด:</span>
          <button
            onClick={toggleCashIncluded}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${cashIncluded ? "bg-emerald-500" : "bg-zinc-700"}`}
            title={cashIncluded ? "ปิดการรวมเงินสด" : "เปิดการรวมเงินสด"}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${cashIncluded ? "translate-x-5" : ""}`} />
          </button>
          <span className={`text-xs font-medium ${cashIncluded ? "text-emerald-400" : "text-zinc-500"}`}>
            {cashIncluded ? "เปิด" : "ปิด"}
          </span>
        </div>

        <div className="text-right">
          <div className="text-[11px] text-zinc-500">
            มูลค่ารวมทั้งหมด (ทุกพอร์ต{cashIncluded ? " + เงินสด" : ""})
          </div>
          <div className="text-base font-mono font-bold text-blue-300">
            {fmtMoney(grandTotalWithCash)}
          </div>
        </div>
      </div>

      <PortfolioGrowthChart
        portfolios={portfolios}
        tdKey={tdKey}
        dataMap={dataMap}
        cashAmount={cashAmount}
        cashIncluded={cashIncluded}
        fmtMoney={fmtMoney}
      />

      <div className="bg-zinc-900 border border-indigo-500/20 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <span>🎯</span> เป้าหมายมูลค่ารวม <span className="text-indigo-400">ทุกพอร์ต</span>{cashIncluded ? " + เงินสด" : ""}
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onBlur={handleGoalCommit}
              placeholder={displayCurrency === "THB" ? "เช่น 5000000" : "เช่น 150000"}
              className="w-36 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-indigo-300"
            />
            <span className="text-[11px] text-zinc-500">{displayCurrency === "THB" ? "บาท" : "USD"}</span>
            <button
              onClick={handleGoalCommit}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition"
            >
              บันทึกเป้าหมาย
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">สกุลเงิน:</span>
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-full p-0.5">
                <button
                  onClick={() => toggleCurrency("USD")}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${displayCurrency === "USD" ? "bg-blue-600 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  USD
                </button>
                <button
                  onClick={() => toggleCurrency("THB")}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${displayCurrency === "THB" ? "bg-emerald-600 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  THB
                </button>
              </div>
            </div>
            <button
              onClick={refreshExchangeRate}
              disabled={rateLoading}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              title="รีเฟรชอัตราแลกเปลี่ยน"
            >
              <RefreshCw size={11} className={rateLoading ? "animate-spin" : ""} />
              {usdThbRate ? `1 USD ≈ ${usdThbRate.toFixed(2)} THB` : "กำลังโหลดเรต..."}
            </button>
          </div>
        </div>

        {rateError && <div className="text-[10px] text-amber-400">{rateError}</div>}

        {portfolioGoal > 0 ? (
          <div>
            <div className="flex justify-between items-center text-[11px] font-mono mb-1.5">
              <span className="text-zinc-400">
                ปัจจุบัน <span className="text-zinc-100 font-bold">{fmtMoney(grandTotalWithCash)}</span>
              </span>
              <span className="text-zinc-400">
                เป้าหมาย <span className="text-indigo-300 font-bold">{fmtMoney(portfolioGoal)}</span>
              </span>
            </div>
            <div className="h-4 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
              <div
                style={{ width: `${goalProgressPct}%` }}
                className={`h-full transition-all duration-500 ${goalProgressPct >= 100 ? "bg-emerald-500" : "bg-gradient-to-r from-indigo-500 to-blue-500"}`}
              />
            </div>
            <div className="text-right text-[11px] font-mono text-zinc-500 mt-1">
              {goalProgressPct.toFixed(1)}% ของเป้าหมาย
              {goalProgressPct >= 100 && <span className="text-emerald-400 font-semibold ml-1">🎉 ถึงเป้าหมายแล้ว!</span>}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500">ตั้งเป้าหมายมูลค่าพอร์ตด้านบนเพื่อติดตามความคืบหน้าไปสู่เป้าหมายในอนาคต</div>
        )}

        {rateUpdatedAt && (
          <div className="text-[10px] text-zinc-600">อัปเดตอัตราแลกเปลี่ยนล่าสุด: {new Date(rateUpdatedAt).toLocaleString("th-TH")}</div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="text-sm font-semibold text-zinc-100 flex items-center justify-between mb-3">
          <span className="flex items-center gap-2">
            <span>⚡</span>
            จัดการหุ้นใน <span className="text-blue-400">"{activePort.name}"</span>
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleImportButtonClick}
              className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300"
              title="อัปโหลดรูปการทำรายการให้ AI อ่านและบันทึกซื้อ/ขายให้อัตโนมัติ"
            >
              <ImageIcon size={13} />
              อัปโหลดรูปทำรายการ (AI อ่านอัตโนมัติ)
            </button>
            <button
              onClick={refreshPortfolioQuotes}
              disabled={loadingQuotes}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loadingQuotes ? "animate-spin" : ""} />
              อัปเดตราคาราคาเรียลไทม์ (Twelve Data)
            </button>
          </div>
        </div>

        <input
          ref={importFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImportFileChange}
        />

        <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          <ImageIcon size={13} className="text-purple-400 shrink-0" />
          การซื้อ/ขายหุ้นทุกครั้งในพอร์ตนี้ทำผ่านการอัปโหลดรูปการทำรายการเท่านั้น — ให้ AI อ่านภาพแล้ววิเคราะห์เองว่าเป็นการซื้อหรือขาย, เป็นหุ้นตัวใหม่หรือเพิ่ม/ตัดขายหุ้นที่มีอยู่แล้ว โดยตรวจสอบและแก้ไขข้อมูลได้ก่อนยืนยัน
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[11px] text-zinc-500">ต้นทุนรวม ({activePort.name})</div>
          <div className="text-base font-mono font-bold text-zinc-100 mt-1">{fmtMoney(summary.totalCost)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[11px] text-zinc-500">มูลค่าปัจจุบันรวม</div>
          <div className="text-base font-mono font-bold text-zinc-100 mt-1">{fmtMoney(summary.totalCurrentVal)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[11px] text-zinc-500">กำไร/ขาดทุน รวม</div>
          <div className={`text-base font-mono font-bold mt-1 ${summary.totalPL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {summary.totalPL >= 0 ? "+" : ""}{fmtMoney(summary.totalPL)}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[11px] text-zinc-500">สถานะล็อกสัดส่วนพอร์ตนี้</div>
          <div className="text-sm font-mono font-bold mt-1">
            {summary.totalOverAllocatedCount > 0 ? (
              <span className="text-red-400 flex items-center gap-1">
                <AlertTriangle size={14} /> เกินโควตา {summary.totalOverAllocatedCount} รายการ
              </span>
            ) : (
              <span className="text-emerald-400">✓ สัดส่วนสมดุลดี</span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-purple-500/20 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <span>🎯</span> เป้าหมายมูลค่าพอร์ต <span className="text-purple-400">"{activePort.name}"</span> โดยเฉพาะ
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              min="0"
              value={portGoalInput}
              onChange={(e) => setPortGoalInput(e.target.value)}
              onBlur={handlePortGoalCommit}
              placeholder={displayCurrency === "THB" ? "เช่น 1000000" : "เช่น 30000"}
              className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-purple-300"
            />
            <span className="text-[11px] text-zinc-500">{displayCurrency === "THB" ? "บาท" : "USD"}</span>
            <button
              onClick={handlePortGoalCommit}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition"
            >
              บันทึก
            </button>
          </div>
        </div>

        {(portfolioGoals[activePort.id] || 0) > 0 ? (
          (() => {
            const portGoalUsd = portfolioGoals[activePort.id] || 0;
            const portPct = Math.min(100, (summary.totalCurrentVal / portGoalUsd) * 100);
            return (
              <div>
                <div className="flex justify-between items-center text-[11px] font-mono mb-1.5">
                  <span className="text-zinc-400">
                    ปัจจุบัน <span className="text-zinc-100 font-bold">{fmtMoney(summary.totalCurrentVal)}</span>
                  </span>
                  <span className="text-zinc-400">
                    เป้าหมาย <span className="text-purple-300 font-bold">{fmtMoney(portGoalUsd)}</span>
                  </span>
                </div>
                <div className="h-3.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                  <div
                    style={{ width: `${portPct}%` }}
                    className={`h-full transition-all duration-500 ${portPct >= 100 ? "bg-emerald-500" : "bg-gradient-to-r from-purple-500 to-fuchsia-500"}`}
                  />
                </div>
                <div className="text-right text-[11px] font-mono text-zinc-500 mt-1">
                  {portPct.toFixed(1)}% ของเป้าหมายพอร์ตนี้
                  {portPct >= 100 && <span className="text-emerald-400 font-semibold ml-1">🎉 ถึงเป้าหมายแล้ว!</span>}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="text-[11px] text-zinc-500">ตั้งเป้าหมายมูลค่าเฉพาะพอร์ตนี้เพื่อติดตามความคืบหน้าแยกจากพอร์ตอื่น</div>
        )}
      </div>

      {summary.totalCurrentVal > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-400 mb-2 font-medium flex justify-between items-center">
            <span>📊 สัดส่วนถือครองของพอร์ต "{activePort.name}"</span>
            <span className="text-[11px] font-mono text-zinc-500">
              เป้าหมายรวม: {summary.totalTargetPctAllocated.toFixed(1)}% / 100%
            </span>
          </div>
          <div className="h-3.5 w-full bg-zinc-950 rounded-full overflow-hidden flex border border-zinc-800">
            {processedPortfolio.map((item, idx) => {
              if (item.actualPct <= 0) return null;
              const colors = [
                "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-amber-500", 
                "bg-indigo-500", "bg-rose-500", "bg-cyan-500", "bg-teal-500"
              ];
              return (
                <div
                  key={item.symbol}
                  style={{ width: `${item.actualPct}%` }}
                  className={`${item.isOver ? "bg-red-500" : colors[idx % colors.length]} h-full transition-all border-r border-zinc-950`}
                  title={`${item.symbol}: ปัจจุบัน ${item.actualPct.toFixed(1)}% | เป้าหมาย ${item.targetPct}% ${item.isOver ? `(เกิน $${fmtPrice(item.excessVal)})` : ""}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5 text-[11px] font-mono">
            {processedPortfolio.map((item) => (
              <div key={item.symbol} className="flex items-center gap-1.5 bg-zinc-950 px-2 py-1 rounded border border-zinc-800">
                <StockLogo symbol={item.symbol} logoUrl={dataMap[item.symbol]?.profile?.logo} size={16} />
                <span className="font-bold text-zinc-200">{item.symbol}:</span>
                <span className={item.isOver ? "text-red-400 font-bold" : "text-zinc-400"}>
                  {item.actualPct.toFixed(1)}% {item.targetPct > 0 ? `(เป้า ${item.targetPct}%)` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
        <div className="text-sm font-semibold text-zinc-200 mb-3 flex items-center justify-between">
          <span>📋 รายชื่อหุ้นในพอร์ต "{activePort.name}" ({portfolio.length} รายการ)</span>
          <span className="text-[11px] text-zinc-500 font-normal">แก้ไข % เป้าหมายในตารางเพื่อคำนวณโควตาใหม่ได้ทันที</span>
        </div>

        {portfolio.length === 0 ? (
          <div className="text-center text-zinc-500 py-8 text-xs">
            ยังไม่มีรายการหุ้นในพอร์ต "{activePort.name}" อัปโหลดรูปการทำรายการด้านบนเพื่อเริ่มบันทึกหุ้นเข้าพอร์ตนี้
          </div>
        ) : (
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="pb-2 cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('symbol')}>
                  ชื่อหุ้น {sortField === 'symbol' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('currVal')}>
                  มูลค่า {sortField === 'currVal' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('shares')}>
                  จำนวนหุ้น {sortField === 'shares' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('pl')}>
                  กำไร/ขาดทุน {sortField === 'pl' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('currPrice')}>
                  ราคาล่าสุด/ต้นทุน {sortField === 'currPrice' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sortedPortfolio.map((item) => {
                const isExpanded = expandedSymbol === item.symbol;
                return (
                <Fragment key={item.symbol}>
                <tr className={`hover:bg-zinc-800/40 transition ${item.isOver ? "bg-red-500/5" : ""}`}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <StockLogo symbol={item.symbol} logoUrl={dataMap[item.symbol]?.profile?.logo} size={28} />
                      <div className="min-w-0">
                        <div className="font-bold text-zinc-100 flex items-center gap-1.5 font-mono">
                          {item.symbol}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate max-w-[140px] sm:max-w-[200px] font-sans">
                          {getStockName(item.symbol, dataMap[item.symbol]?.profile?.name)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-bold text-zinc-100">${fmtPrice(item.currVal)}</td>
                  <td className="py-2.5 text-right text-zinc-200 font-semibold">{item.shares}</td>
                  <td className="py-2.5 text-right">
                    <div className={`font-bold ${item.pl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {item.pl >= 0 ? "+" : ""}${fmtPrice(item.pl)}
                    </div>
                    <div className={`text-[10px] ${item.pl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtPct(item.plPct)}
                    </div>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="font-bold text-zinc-100">
                      {item.currPrice != null ? `$${fmtPrice(item.currPrice)}` : <span className="text-zinc-500">กำลังโหลด...</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500">ต้นทุน ${fmtPrice(item.avgCost)}</div>
                  </td>
                  <td className="py-2.5 text-center">
                    <button
                      onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}
                      className={`px-2.5 py-1 rounded border text-[11px] font-medium inline-flex items-center gap-1 transition ${
                        isExpanded
                          ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                          : "bg-zinc-950 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      } ${item.isOver ? "ring-1 ring-red-500/50" : ""}`}
                    >
                      จัดการ {item.isOver && <AlertTriangle size={11} className="text-red-400" />} {isExpanded ? "▲" : "▼"}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-zinc-950/60">
                    <td colSpan={6} className="py-3 px-2">
                      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-zinc-500">สัดส่วน (%เป้า / %จริง):</span>
                            <input
                              type="number"
                              step="any"
                              value={item.targetPct}
                              onChange={(e) => updateTargetPct(item.symbol, e.target.value)}
                              className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-center text-xs font-bold text-blue-400"
                            />
                            <span className="text-zinc-500">% /</span>
                            <span className={`font-bold ${item.isOver ? "text-red-400" : "text-zinc-200"}`}>
                              {item.actualPct.toFixed(1)}%
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-zinc-500">โควตาซื้อได้:</span>
                            {item.targetPct > 0 ? (
                              <span className="text-zinc-200 font-bold">${fmtPrice(item.maxAllowedVal)}</span>
                            ) : (
                              <span className="text-zinc-500">ไม่ได้ล็อก</span>
                            )}
                          </div>

                          <div>
                            {item.targetPct > 0 ? (
                              item.isOver ? (
                                <div className="inline-block px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-bold text-[11px]">
                                  🚨 เกินสัดส่วน +${fmtPrice(item.excessVal)} (+{item.excessPct.toFixed(1)}%)
                                </div>
                              ) : (
                                <div className="inline-block px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px]">
                                  ✓ ซื้อได้อีก ${fmtPrice(Math.abs(item.currVal - item.maxAllowedVal))}
                                </div>
                              )
                            ) : (
                              <span className="text-zinc-600 text-[11px]">— ยังไม่ได้ตั้งเป้าหมาย —</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                          <span className="text-[10px] text-zinc-600">
                            ซื้อเพิ่ม/ตัดขายหุ้นนี้ผ่านการอัปโหลดรูปทำรายการด้านบน
                          </span>
                          <button
                            onClick={() => deletePosition(item.symbol)}
                            className="px-2.5 py-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 text-[11px] font-medium ml-auto flex items-center gap-1"
                          >
                            <Trash2 size={13} /> ลบออก
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showImportModal && (
        <ImportPortfolioModal
          activePort={activePort}
          portfolio={portfolio}
          importPreview={importPreview}
          importLoading={importLoading}
          importError={importError}
          importRows={importRows}
          importFileRef={importFileRef}
          handleImportFileChange={handleImportFileChange}
          updateImportRow={updateImportRow}
          removeImportRow={removeImportRow}
          confirmImportRows={confirmImportRows}
          closeImportModal={closeImportModal}
        />
      )}
    </div>
  );
});

/* ============================================================
   WATCHLIST POSITION & PROFIT CALCULATOR
   ============================================================ */
