import { Component, Fragment } from "react";
import { AlertTriangle, RefreshCw } from "./icons.jsx";
import { redactError, redactSecrets } from "../utils/redact.js";

/* ------------------------------------------------------------
   ErrorBoundary — กัน React error ตัวเดียวลากทั้งแอปให้เป็นหน้าขาว (White Screen of Death)
   ------------------------------------------------------------
   ครอบแต่ละแท็บหลักใน App.jsx แยกกัน: ถ้าแท็บใดพัง จะแสดง fallback UI เฉพาะที่แท็บนั้น
   ส่วนแท็บอื่นและ header ยังใช้งานได้ตามปกติ

   ข้อจำกัดของ Error Boundary (เป็นข้อจำกัดของ React เอง ไม่ใช่ของโค้ดนี้): จับได้เฉพาะ error ที่เกิดตอน
   render / lifecycle / constructor ของคอมโพเนนต์ลูกเท่านั้น — จะ "ไม่" จับ error ใน event handler,
   โค้ด async (await / setTimeout / promise ที่ไม่ได้ catch) ซึ่งกรณีเหล่านั้นต้องมี try/catch เอง

   การ retry: เพิ่ม counter แล้วใช้เป็น key ของ Fragment ที่ห่อ children เพื่อบังคับ "mount ใหม่" ทั้งซับทรี
   (state ภายในของแท็บนั้นจะรีเซ็ต) — ถ้าสาเหตุของ error ยังอยู่ (เช่น ข้อมูลใน state/localStorage เสีย)
   มันจะพังซ้ำและกลับมาที่ fallback อีกครั้ง ซึ่งเป็นพฤติกรรมที่ถูกต้อง

   ความปลอดภัย: error message / stack ที่ "เรา" log และแสดงใน UI ผ่าน redactError / redactSecrets ก่อนเสมอ
   ตามแนวทางของโปรเจกต์ (ดู utils/redact.js) แต่ React เองก็ console.error ตัว error ดิบของมันเองอีกบรรทัด
   ทุกครั้งที่ boundary จับ error ได้ (แก้ไม่ได้จากในคอมโพเนนต์) — ดังนั้นแนวป้องกันหลักของ API key ยังคงเป็น
   การ redact "ที่ต้นทาง" (secureFetch) ส่วน boundary นี้เป็นชั้นเสริมสำหรับสิ่งที่แสดงใน UI และที่เรา log เอง
   ------------------------------------------------------------ */

const MAX_MESSAGE_LEN = 300;

function describeError(error) {
  const clean = redactError(error);
  const raw = clean instanceof Error ? clean.message : typeof clean === "string" ? clean : "";
  const msg = (raw || "").trim() || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
  return msg.length > MAX_MESSAGE_LEN ? `${msg.slice(0, MAX_MESSAGE_LEN)}…` : msg;
}

export class ErrorBoundary extends Component {
  // ใช้ hasError แยกจาก error เผื่อมีโค้ดที่ throw ค่า falsy (throw null / undefined) —
  // ถ้าเช็คแค่ `error` จะไม่แสดง fallback และแท็บจะกลับเป็นหน้าขาวอีก
  state = { hasError: false, error: null, retries: 0 };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    const name = this.props.name || "unknown";
    const cleanError = redactError(error);
    const componentStack = redactSecrets(info?.componentStack || "");
    // ส่ง Error object ตรง ๆ ให้ console แสดง stack trace แบบ expandable ของเบราว์เซอร์ และแนบ
    // component stack แยกไว้ เพื่อดูว่า error เกิดใต้คอมโพเนนต์ตัวไหน
    console.error(`[ErrorBoundary] แท็บ "${name}" พัง:`, cleanError, `\nComponent stack:${componentStack}`);
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, error: null, retries: s.retries + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      return <Fragment key={this.state.retries}>{this.props.children}</Fragment>;
    }

    const { name = "แท็บนี้" } = this.props;
    const { error, retries } = this.state;

    return (
      <div
        role="alert"
        className="bg-zinc-900 border border-red-500/30 rounded-lg p-6 flex flex-col items-center text-center gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
          <AlertTriangle size={20} />
        </div>
        <div className="text-sm font-semibold text-zinc-100">“{name}” แสดงผลไม่สำเร็จ</div>
        <div className="text-xs text-zinc-400 max-w-md">
          เกิดข้อผิดพลาดในส่วนนี้ แท็บอื่นยังใช้งานได้ตามปกติ
        </div>
        <code className="block max-w-full break-words text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2.5 py-1.5">
          {describeError(error)}
        </code>
        <button
          type="button"
          onClick={this.handleRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium text-white transition-colors"
        >
          <RefreshCw size={13} /> ลองใหม่
        </button>
        {retries >= 2 && (
          <div className="text-[11px] text-zinc-500">
            ลองใหม่แล้ว {retries} ครั้งแต่ยังพัง — ลองรีเฟรชหน้าเว็บ หรือดูรายละเอียดใน Console (F12)
          </div>
        )}
      </div>
    );
  }
}
