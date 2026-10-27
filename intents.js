// Hieu cau noi tieng Viet cua nguoi dung (ban web khong co LLM): tu khoa -> y dinh.
// Cung gioi han voi system-prompt.vi.md: chi noi ve suc khoe, khong chan doan, khong ke thuoc, trieu chung nguy hiem -> 115.
(function (root) {
    "use strict";
    // bo dau: "Đo nhịp tim" -> "do nhip tim"
    const fold = s => (" " + s + " ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ");
    const has = (t, words) => words.some(w => t.includes(" " + w + " "));

    const DANGER = ["dau nguc", "tuc nguc", "kho tho", "ngat", "xiu", "co giat", "meo mieng", "yeu liet",
        "chay mau", "tu tu", "tu hai", "khong tho duoc"];
    const MEASURE = ["do", "do nhip", "nhip tim", "nhip tho", "kiem tra", "do thu", "do giup", "do lai", "mach"];
    const YES = ["co", "u", "uh", "vang", "da", "dong y", "duoc", "ok", "oke", "dong", "di", "nhe"];
    const NO = ["khong", "thoi", "khong can", "chua", "de sau"];
    const SYMPTOM = ["met", "chong mat", "hoi hop", "kho ngu", "mat ngu", "dau dau", "uong", "cang thang",
        "hoa mat", "buon non", "sot", "ho", "dau bung", "met moi", "lo au", "tim dap nhanh"];
    const MEDICINE = ["thuoc", "uong gi", "lieu", "ke don", "benh gi", "chan doan", "co bi benh"];
    const BYE = ["tam biet", "cam on", "het roi", "khong can nua", "chao nhe", "bye", "thoi nhe"];
    const HELLO = ["xin chao", "chao", "alo", "hello"];

    // context: y ta vua hoi "co muon do khong" -> "co"/"khong" tra loi cau do
    function classify(text, ctx = {}) {
        const t = fold(text);
        if (!t.trim()) return "empty";
        if (has(t, DANGER)) return "danger";
        if (has(t, BYE)) return "bye";
        if (ctx.offered && has(t, NO) && !has(t, ["khong can nua"])) return "no";
        if (has(t, MEASURE) || (ctx.offered && has(t, YES))) return "measure";
        if (has(t, MEDICINE)) return "medicine";
        if (has(t, SYMPTOM)) return "symptom";
        if (has(t, HELLO)) return "hello";
        return "other";
    }

    const api = { classify, fold };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.Intents = api;
})(typeof window !== "undefined" ? window : globalThis);
