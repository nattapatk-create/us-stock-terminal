import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ToastProvider } from "./components/ToastProvider.jsx";
import { scrubSecretsFromLocation } from "./utils/redact.js";
import "./index.css";

// แอปไม่เคยอ่าน API key จาก URL — ถ้ามี ?apikey=... ติดมา (เช่น ลิงก์ที่มีคนแนบมา) ให้ลบออกจาก address bar
// ก่อนเริ่มทำงาน กันค้างในประวัติเบราว์เซอร์/ถูกคัดลอกไปแชร์ต่อ
scrubSecretsFromLocation();

createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
