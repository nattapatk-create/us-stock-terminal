import { useEffect, useState } from "react";

/* ------------------------------------------------------------
   Recharts แบบโหลดทีหลัง (lazy)
   ------------------------------------------------------------
   Recharts หนักเกือบ 1MB แต่ถูกใช้แค่ 2 จุด (กราฟราคาในหน้ารายละเอียดหุ้น และ
   กราฟการเติบโตของพอร์ต) ผู้ใช้ส่วนใหญ่เข้ามาดู Watchlist แล้วปิดไปโดยไม่เปิดกราฟเลย —
   จึงใช้ dynamic import() ให้ bundler (Vite/Rollup) ตัด Recharts ออกเป็น chunk แยก แล้วโหลด
   หลังหน้าแรกวาดเสร็จ (requestIdleCallback) จึงไม่หน่วงเวลาเปิดเว็บ และเกือบทุกครั้งจะโหลด
   เสร็จก่อนที่ผู้ใช้จะกดเปิดกราฟจริง ๆ
   ------------------------------------------------------------ */
let rechartsModule = null;
let rechartsPromise = null;

function loadRecharts() {
  if (rechartsModule) return Promise.resolve(rechartsModule);
  if (rechartsPromise) return rechartsPromise;
  rechartsPromise = import("recharts")
    .then((mod) => {
      rechartsModule = mod;
      return mod;
    })
    .catch((err) => {
      console.error("[Boot] โหลด Recharts ไม่สำเร็จ — กราฟจะแสดงไม่ได้ แต่ส่วนอื่นของแอปยังใช้งานได้ปกติ", err);
      rechartsPromise = null; // เปิดกราฟครั้งหน้าให้ลองใหม่
      return null;
    });
  return rechartsPromise;
}

// เริ่มโหลดล่วงหน้าตอนเบราว์เซอร์ว่าง (หลังหน้าแรกวาดเสร็จ) — ผู้ใช้จึงแทบไม่เคยเห็นตัว
// placeholder ด้านล่างเลย แต่เวลาเปิดเว็บครั้งแรกไม่ต้องรอ chunk นี้
if (typeof requestIdleCallback === "function") requestIdleCallback(() => loadRecharts(), { timeout: 4000 });
else setTimeout(loadRecharts, 1500);

// hook สำหรับคอมโพเนนต์กราฟ — คืน module ของ Recharts เมื่อพร้อมใช้งานแล้ว, หรือ null ถ้ายังไม่พร้อม
export function useRecharts() {
  const [mod, setMod] = useState(() => rechartsModule);
  useEffect(() => {
    if (mod) return;
    let cancelled = false;
    loadRecharts().then((m) => { if (!cancelled && m) setMod(m); });
    return () => { cancelled = true; };
  }, [mod]);
  return mod;
}
