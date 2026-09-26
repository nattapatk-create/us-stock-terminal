import { createContext, useContext } from "react";

export const ToastContext = createContext(null);

/**
 * ใช้แจ้งผลลัพธ์แบบไม่บล็อก UI (แทน window.alert)
 *
 *   const toast = useToast();
 *   toast.success("บันทึกแล้ว");
 *   toast.error(err);                       // ส่ง Error ได้ตรง ๆ
 *   toast.warning("ข้อความ", { title: "หัวข้อ", duration: 8000 });   // duration: 0 = ค้างจนกว่าจะกดปิด
 *   toast.info("...");
 *   toast.showAfterReload("success", "..."); // แสดงหลัง window.location.reload()
 *
 * ค่าที่คืนมามี identity คงที่ตลอดอายุแอป — ใส่ใน dependency array / ส่งเข้า memo component ได้ปลอดภัย
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() ต้องถูกเรียกภายใน <ToastProvider>");
  return ctx;
}
