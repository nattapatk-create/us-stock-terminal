/* ------------------------------------------------------------
   ตรรกะล้วน ๆ ของคิว Toast (ไม่มี React / DOM) — แยกออกมาเพื่อให้เทสต์ผ่าน plain `node` ได้
   ตัวที่ใช้จริงคือ components/ToastProvider.jsx + hooks/useToast.js
   ------------------------------------------------------------ */
import { redactSecrets } from "./redact.js";

export const TOAST_TYPES = ["success", "error", "warning", "info"];

// ระยะเวลาแสดงก่อนหายเอง (ms) — error/warning อยู่นานกว่าเพราะผู้ใช้ต้องมีเวลาอ่านและทำความเข้าใจ
// ส่ง `duration: 0` เพื่อให้ toast ค้างจนกว่าผู้ใช้จะกดปิดเอง
export const DEFAULT_DURATION_MS = { success: 3500, info: 4000, warning: 6000, error: 8000 };

// แสดงพร้อมกันได้สูงสุดกี่อัน — เกินนี้ตัวเก่าสุดจะถูกดันออก (กัน toast ท่วมจอตอนเกิดหลายเหตุการณ์ติดกัน)
export const MAX_VISIBLE_TOASTS = 5;

// เวลาให้ animation ตอนหายเล่นจบก่อนถอด element ออกจริง
export const EXIT_ANIMATION_MS = 180;

// แปลงอะไรก็ตามที่ส่งมาเป็นข้อความ (รองรับ Error) แล้วผ่าน redactSecrets เสมอ:
// toast เป็นอีกพื้นผิวหนึ่งที่แสดงข้อความ error ให้ผู้ใช้ จึงต้องไม่ปล่อย API key หลุดออกมาทางนี้
// (แนวทางเดียวกับ ErrorBoundary — ดู utils/redact.js)
export function toToastText(value) {
  if (value == null) return "";
  const raw = value instanceof Error ? value.message : String(value);
  return redactSecrets(raw);
}

export function createToast(input, id) {
  const opts = input && typeof input === "object" ? input : { message: input };
  const type = TOAST_TYPES.includes(opts.type) ? opts.type : "info";
  const duration = Number.isFinite(opts.duration) && opts.duration >= 0
    ? opts.duration
    : DEFAULT_DURATION_MS[type];
  return {
    id,
    type,
    title: toToastText(opts.title),
    message: toToastText(opts.message),
    duration,
    leaving: false,
  };
}

const toastKey = (t) => `${t.type}|${t.title}|${t.message}`;

// เพิ่ม toast ใหม่ท้ายคิว: ถ้ามีอันเหมือนกันเป๊ะ (type+title+message) อยู่แล้ว ให้แทนที่อันเดิม
// (แทนที่จะซ้อนกันหลายใบเวลาผู้ใช้กดซ้ำ ๆ) และตัดตัวเก่าสุดออกเมื่อเกินเพดาน
export function pushToast(list, toast, max = MAX_VISIBLE_TOASTS) {
  const next = [...list.filter((t) => toastKey(t) !== toastKey(toast)), toast];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function markLeaving(list, id) {
  return list.map((t) => (t.id === id && !t.leaving ? { ...t, leaving: true } : t));
}

export function removeToast(list, id) {
  return list.filter((t) => t.id !== id);
}
