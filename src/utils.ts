import { Interaction } from "./types.js";

// Helper to format date nicely
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (e) {
    return dateStr;
  }
}

// Convert data to Excel-compatible CSV with UTF-8 BOM so Arabic letters display correctly
export function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((val) => {
          const cleanVal = (val || "").replace(/"/g, '""');
          return `"${cleanVal}"`;
        })
        .join(",")
    ),
  ].join("\n");

  // Include UTF-8 BOM (\uFEFF) for Excel RTL Arabic rendering compatibility
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Format interaction export
export function exportInteractionsToCSV(interactions: Interaction[]) {
  const headers = [
    "معرّف التفاعل",
    "التاريخ",
    "الوقت",
    "اسم العميل",
    "رقم الهاتف",
    "نوع التفاعل",
    "وسيلة الاتصال",
    "اتجاه الاتصال",
    "العلامة التجارية",
    "التصنيف",
    "الأولوية",
    "الحالة",
    "الملخص",
    "الإجراء المتخذ",
    "متابعة مطلوبة",
    "تاريخ المتابعة",
    "ملاحظات المتابعة",
    "اسم الموظف",
  ];

  const rows = interactions.map((i) => [
    i.id,
    i.interaction_date,
    i.interaction_time,
    i.customer_name,
    i.customer_phone,
    i.interaction_type,
    i.communication_type,
    i.call_direction,
    i.brand,
    i.category,
    i.priority,
    i.status,
    i.summary,
    i.action_taken,
    i.follow_up_required ? "نعم" : "لا",
    i.follow_up_date || "",
    i.follow_up_notes || "",
    i.agent_name,
  ]);

  downloadCSV(headers, rows, `تقرير_التفاعلات_${new Date().toISOString().split("T")[0]}`);
}

// Download file helper (converts base64 data to Blob URL and downloads)
export function downloadFile(fileName: string, mimeType: string, base64Data: string) {
  const byteCharacters = atob(base64Data.split(",")[1] || base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
