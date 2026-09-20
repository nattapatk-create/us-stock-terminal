import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastContext } from "../hooks/useToast.js";
import { EXIT_ANIMATION_MS, MAX_VISIBLE_TOASTS, createToast, markLeaving, pushToast, removeToast, toToastText } from "../utils/toastQueue.js";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "./icons.jsx";

// คีย์ใน sessionStorage สำหรับ toast ที่ต้องโผล่ "หลัง reload" (เช่นนำเข้าไฟล์สำรองแล้วต้อง reload หน้า)
const PENDING_KEY = "us-dash-pending-toast";

function takePendingToast() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// class ต้องเขียนเป็น string เต็ม ๆ (Tailwind สแกนจากซอร์ส) จึงไม่ประกอบชื่อ class จากตัวแปร
const STYLES = {
  success: { Icon: CheckCircle, border: "border-emerald-500/40", accent: "text-emerald-400", bar: "bg-emerald-400", role: "status" },
  error: { Icon: XCircle, border: "border-red-500/40", accent: "text-red-400", bar: "bg-red-400", role: "alert" },
  warning: { Icon: AlertTriangle, border: "border-amber-500/40", accent: "text-amber-400", bar: "bg-amber-400", role: "alert" },
  info: { Icon: Info, border: "border-blue-500/40", accent: "text-blue-400", bar: "bg-blue-400", role: "status" },
};

function ToastItem({ toast, onClose }) {
  const { id, type, title, message, duration, leaving } = toast;
  const s = STYLES[type];
  // เอาเมาส์ชี้/โฟกัสอยู่ = หยุดนับเวลา จะได้อ่านทัน (และกดปุ่มปิดได้สะดวก)
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!(duration > 0) || leaving || paused) return undefined;
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => onClose(id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      // เก็บเวลาที่เหลือไว้ ตอน resume จะนับต่อจากเดิมแทนที่จะเริ่มใหม่
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    };
  }, [duration, leaving, paused, id, onClose]);

  return (
    <div
      role={s.role}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto relative overflow-hidden rounded-lg border bg-zinc-900/95 shadow-xl shadow-black/40 backdrop-blur ${s.border} ${leaving ? "toast-leave" : "toast-enter"}`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={`mt-0.5 shrink-0 ${s.accent}`}><s.Icon size={16} /></span>
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {title && <div className="font-semibold text-zinc-100">{title}</div>}
          <div className="text-zinc-300 whitespace-pre-line break-words">{message}</div>
        </div>
        <button
          type="button"
          onClick={() => onClose(id)}
          aria-label="ปิดการแจ้งเตือน"
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      {duration > 0 && (
        <div className="toast-progress-track absolute inset-x-0 bottom-0 h-0.5 bg-zinc-800/70" aria-hidden="true">
          <div
            className={`toast-progress h-full ${s.bar}`}
            style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seqRef = useRef(0);

  const dismiss = useCallback((id) => {
    // เล่น animation ตอนหายก่อน แล้วค่อยถอดออกจากคิวจริง
    setToasts((prev) => markLeaving(prev, id));
    setTimeout(() => setToasts((prev) => removeToast(prev, id)), EXIT_ANIMATION_MS);
  }, []);

  const show = useCallback((input) => {
    const id = `toast-${++seqRef.current}`;
    setToasts((prev) => pushToast(prev, createToast(input, id), MAX_VISIBLE_TOASTS));
    return id;
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  const showAfterReload = useCallback((type, message, opts) => {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...opts, type, message: toToastText(message) }));
    } catch {
      // sessionStorage ใช้ไม่ได้ (เช่นโหมดส่วนตัวบางแบบ) — ยอมไม่แสดง toast แทนที่จะทำให้ flow หลักพัง
    }
  }, []);

  // แสดง toast ที่ฝากไว้ก่อน reload (ถ้ามี) ครั้งเดียวตอนแอปเปิด
  useEffect(() => {
    const pending = takePendingToast();
    if (pending) show(pending);
  }, [show]);

  // identity คงที่ตลอดอายุแอป — คอมโพเนนต์ที่ memo ไว้ (เช่น PortfolioView) จึงไม่ re-render เพราะ toast
  const api = useMemo(() => {
    const make = (type) => (message, opts) => show({ ...opts, type, message });
    return {
      show,
      success: make("success"),
      error: make("error"),
      warning: make("warning"),
      info: make("info"),
      dismiss,
      clear,
      showAfterReload,
    };
  }, [show, dismiss, clear, showAfterReload]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="การแจ้งเตือน"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

