// ReBox Nurse ban web: y ta ao + do nhip tim/nhip tho qua camera ngay tren trinh duyet (rppg.js).
// Nghe: SpeechRecognition cua trinh duyet (vi-VN) + tu khoa (intents.js) - khong co LLM nhu ban xiaozhi tren box.
// Noi: speechSynthesis, giong nu tieng Viet.
"use strict";

const GREET = "Chào bác, cháu là y tá ReSmartBox đến từ Phòng khám Chuyên khoa Nội Gia Đình. " +
    "Hôm nay bác thấy trong người thế nào ạ?";
const ASK = "Dạ được ạ. Bác ngồi thẳng, nhìn vào camera, đặt mặt vào khung và giữ yên khoảng 30 giây nhé.";
const OFFER = "Bác có muốn cháu đo thử nhịp tim và nhịp thở qua camera không ạ?";
const NOTE = "Số liệu chỉ để tham khảo, không thay thế thiết bị y tế.";
const ADVICE = "Bác ngồi gần hơn, đủ sáng, giữ yên mặt trong khung rồi thử lại nhé.";
const NEED_S = 30, TIMEOUT_S = 120, RESET_GAP_S = 2, STEP_CAP_S = 0.5, SKIN_MIN = 0.45, SAMPLE_W = 160;
const MAX_SILENT = 3;          // so lan nghe lien tiep khong thay gi -> thoi tu nghe, cho bam mic

const $ = id => document.getElementById(id);
const video = $("video");
let stream = null, devices = [], devIdx = 0, facing = "user", voiceOn = true, viVoice = null;

// ---------- y ta: chat, giong, nhep moi, chop mat ----------
function show(layer, on) { document.querySelector(`[data-l="${layer}"]`).classList.toggle("on", on); }
function mouth(m) { for (const k of ["closed", "small", "open", "round"]) show("mouth_" + k, k === m); }
setInterval(() => { show("eyes_closed", true); setTimeout(() => show("eyes_closed", false), 150); }, 4200);

function addMsg(role, text) {
    const d = document.createElement("div");
    d.className = "msg " + role;
    d.textContent = text;
    $("log").appendChild(d);
    $("log").scrollTop = $("log").scrollHeight;
}

// giong nu tieng Viet: Google Tieng Viet (Chrome), HoaiMy (Edge/Windows), Linh (iOS/macOS); bo giong nam
const FEMALE = /hoaimy|hoai my|linh|google|female|nữ/i, MALE = /namminh|nam minh|\ban\b|male/i;
function pickVoice() {
    const vi = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith("vi"));
    viVoice = vi.find(v => FEMALE.test(v.name) && !MALE.test(v.name)) || vi.find(v => !MALE.test(v.name)) || vi[0] || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

let talkTimer = null;
function talking(on) {
    clearInterval(talkTimer);
    if (!on) return mouth("closed");
    const seq = ["open", "small", "round", "small", "open", "closed"];
    let i = 0;
    talkTimer = setInterval(() => mouth(seq[i++ % seq.length]), 130);
}

function say(text) {
    stopListening();                                    // khong tu nghe chinh giong y ta
    addMsg("nurse", text);
    return new Promise(done => {
        const fallback = () => { talking(true); setTimeout(() => { talking(false); done(); }, Math.min(8000, text.length * 55)); };
        if (!voiceOn || !viVoice) return fallback();       // khong co giong tieng Viet: chi nhep moi
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = viVoice; u.lang = viVoice.lang; u.rate = 1;
        u.pitch = MALE.test(viVoice.name) ? 1.3 : 1.1;      // chi co giong nam thi nang cao do cho gan giong nu
        u.onstart = () => talking(true);
        u.onend = u.onerror = () => { talking(false); done(); };
        speechSynthesis.speak(u);
    });
}

// nut goi y: chuoi = cau nguoi dung noi; [nhan, ham] = hanh dong rieng
function chips(list) {
    $("chips").innerHTML = "";
    for (const item of list) {
        const [label, fn] = Array.isArray(item) ? item : [item, () => userSays(item)];
        const b = document.createElement("button");
        b.className = "chip"; b.textContent = label;
        b.onclick = () => { chips([]); fn(); };
        $("chips").appendChild(b);
    }
}
const MAIN_CHIPS = ["Đo nhịp tim cho tôi", "Tôi hơi mệt", "Tạm biệt"];

function toast(text) {
    const t = $("toast");
    t.textContent = text; t.style.display = "block";
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.display = "none"; }, 2500);
}

// ---------- hoi thoai ----------
let offered = false;           // y ta vua hoi "co muon do khong"
let convo = false;             // dang trong cuoc tro chuyen -> tu nghe sau moi luot y ta noi

async function userSays(text) {
    addMsg("user", text);
    chips([]);
    const intent = Intents.classify(text, { offered });
    offered = false;
    switch (intent) {
        case "danger":
            await say("Bác cần được giúp ngay ạ. Bác gọi 115 hoặc báo nhân viên phòng khám ngay nhé, đừng chờ đo.");
            break;
        case "measure":
            return startMeasure();
        case "no":
            await say("Dạ vâng, bác cần gì cứ nói với cháu nhé.");
            break;
        case "symptom":
            await say("Dạ bác nên nghỉ ngơi và uống đủ nước. " + OFFER);
            offered = true;
            break;
        case "medicine":
            await say("Dạ việc dùng thuốc hay chẩn đoán cần bác sĩ hoặc dược sĩ trực tiếp tư vấn ạ. " + OFFER);
            offered = true;
            break;
        case "bye":
            await say("Dạ cháu chúc bác nhiều sức khoẻ, hẹn gặp lại bác ạ!");
            convo = false;
            chips(MAIN_CHIPS);
            return;
        case "hello":
            await say(GREET);
            break;
        case "empty":
            break;
        default:
            await say("Dạ cháu chỉ hỗ trợ được về sức khoẻ và đo nhịp tim, nhịp thở thôi ạ. " + OFFER);
            offered = true;
    }
    chips(offered ? ["Có, đo giúp tôi", "Không cần"] : MAIN_CHIPS);
    listen();
}

// ---------- nghe (SpeechRecognition) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, silent = 0, micOk = false;

function micUI(on) {
    listening = on;
    $("mic").classList.toggle("on", on);
    $("heard").textContent = on ? "Cháu đang nghe…" : "";
}

function stopListening() {
    if (rec) { rec.onend = null; try { rec.abort(); } catch (e) {} rec = null; }
    micUI(false);
}

function listen(manual) {
    if (!SR || !micOk || measuring || listening || (!convo && !manual)) return;
    if (manual) { convo = true; silent = 0; }
    let heard = "";
    rec = new SR();
    rec.lang = "vi-VN";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
        let text = "";
        for (const r of e.results) text += r[0].transcript;
        $("heard").textContent = "🎤 " + text;
        if (e.results[e.results.length - 1].isFinal) heard = text.trim();
    };
    rec.onerror = e => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            micOk = false; convo = false;
            toast("Chưa có quyền micro - bác vẫn bấm được các nút bên dưới");
        }
    };
    rec.onend = () => {
        rec = null;
        micUI(false);
        if (heard) { silent = 0; userSays(heard); return; }
        if (convo && ++silent < MAX_SILENT) return listen();
        convo = false;
        $("heard").textContent = "Bấm 🎤 để nói với y tá";
    };
    try { rec.start(); micUI(true); } catch (e) { micUI(false); }
}

async function requestMic() {
    if (!SR) {
        $("mic").disabled = true;
        await say("Trình duyệt này chưa nghe được giọng nói. Bác dùng Chrome hoặc Safari, hoặc bấm các nút bên dưới nhé.");
        return false;
    }
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });   // xin quyen micro ngay tu dau
        s.getTracks().forEach(t => t.stop());
        return (micOk = true);
    } catch (e) {
        await say("Cháu chưa được phép dùng micro nên chưa nghe được bác nói. Bác cho phép Micro ở biểu tượng ổ khoá cạnh địa chỉ trang, hoặc bấm các nút bên dưới nhé.");
        return false;
    }
}

// ---------- camera ----------
async function openCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const video_c = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (devices.length > 1) video_c.deviceId = { exact: devices[devIdx].deviceId };
    else video_c.facingMode = { ideal: facing };
    stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
    const s = stream.getVideoTracks()[0].getSettings();
    if (s.facingMode) facing = s.facingMode;
    $("view").classList.toggle("mirror", facing !== "environment");   // camera truoc: hien nhu soi guong
    if (!devices.length || !devices[0].label) {                      // sau khi co quyen moi co ten camera
        devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        devIdx = Math.max(0, devices.findIndex(d => d.deviceId === s.deviceId));
    }
    return stream.getVideoTracks()[0].label;
}

const MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);
async function switchCamera() {
    if (!stream) return toast("Chưa mở được camera");
    if (devices.length < 2 && !MOBILE) return toast("Máy này chỉ có 1 camera");
    if (devices.length > 1) devIdx = (devIdx + 1) % devices.length;
    else facing = facing === "user" ? "environment" : "user";
    try {
        const label = await openCamera();
        toast("Camera: " + (label || (facing === "user" ? "trước" : "sau")));
        if (measuring) resetRun();
    } catch (e) { toast("Không đổi được camera: " + e.name); }
}

async function requestCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        await say("Trình duyệt này không hỗ trợ camera. Bác mở trang bằng Chrome, Safari hoặc Edge qua https nhé.");
        return false;
    }
    try {
        await openCamera();
        return true;
    } catch (e) {
        const denied = e.name === "NotAllowedError" || e.name === "SecurityError";
        await say(denied
            ? "Cháu chưa được phép dùng camera. Bác bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Camera, rồi bấm Thử lại nhé."
            : "Cháu không mở được camera (" + e.name + "). Bác kiểm tra camera có đang được ứng dụng khác dùng không nhé.");
        chips([["Thử lại", async () => { if (await requestCamera()) begin(); }]]);
        return false;
    }
}

// ---------- do ----------
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let measuring = false, run = null, t0 = 0;

function geom(W, H) {                           // khung huong dan + vung tran/ma, theo canh ngan S
    const S = Math.min(W, H), cx = W / 2, cy = H * 0.45;
    return { cx, cy, rx: 0.2 * S, ry: 0.26 * S, S,
        roi: [cx - 0.12 * S, cy - 0.17 * S, cx + 0.12 * S, cy + 0.08 * S] };
}

function drawGuide() {
    const W = video.videoWidth || 640, H = video.videoHeight || 480, g = geom(W, H), sv = $("guide");
    sv.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const sh = g.cy + g.ry;
    sv.innerHTML = `<g fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="${g.S / 110}" stroke-dasharray="${g.S / 40} ${g.S / 60}">
      <ellipse cx="${g.cx}" cy="${g.cy}" rx="${g.rx}" ry="${g.ry}"/>
      <path d="M${g.cx - g.rx * 1.9} ${H} Q${g.cx - g.rx * 1.6} ${sh + 0.15 * g.S} ${g.cx - g.rx * 0.45} ${sh + 0.04 * g.S}"/>
      <path d="M${g.cx + g.rx * 1.9} ${H} Q${g.cx + g.rx * 1.6} ${sh + 0.15 * g.S} ${g.cx + g.rx * 0.45} ${sh + 0.04 * g.S}"/></g>`;
}

function resetRun() { run = { valid_s: 0, samples: [], prev: null, last: null }; }

function frame(now) {
    if (!measuring) return;
    const t = now / 1000, W = video.videoWidth, H = video.videoHeight;
    if (W && H) {
        const k = SAMPLE_W / W, h = Math.round(H * k);
        canvas.width = SAMPLE_W; canvas.height = h;
        ctx.drawImage(video, 0, 0, SAMPLE_W, h);
        const [x0, y0, x1, y1] = geom(W, H).roi.map(v => Math.round(v * k));
        const m = RPPG.roiMean(ctx.getImageData(0, 0, SAMPLE_W, h).data, SAMPLE_W, x0, y0, x1, y1);
        const valid = !!m.rgb && m.skin >= SKIN_MIN;
        if (run.last !== null && t - run.last >= RESET_GAP_S) resetRun();   // mat mat >= 2 s: do lai
        if (valid && run.prev && run.prev.valid) run.valid_s += Math.min(t - run.prev.t, STEP_CAP_S);
        if (valid) { run.last = t; run.samples.push({ t, rgb: m.rgb }); }
        run.prev = { t, valid };
        $("view").className = "view " + (valid ? "valid" : "invalid") + ($("view").classList.contains("mirror") ? " mirror" : "");
        $("prog").style.width = Math.min(100, run.valid_s / NEED_S * 100) + "%";
        $("status").textContent = valid ? `Giữ yên nhé… còn ${Math.max(0, Math.ceil(NEED_S - run.valid_s))} giây`
            : "Đặt mặt vào khung, đủ sáng, nhìn thẳng camera";
        if (run.valid_s >= NEED_S || t - t0 >= TIMEOUT_S) return finish();
    }
    nextFrame();
}

// moi khung camera MOI mot mau (khong lay trung khung theo tan so ve man hinh)
let lastMediaTime = -1;
function nextFrame() {
    if ("requestVideoFrameCallback" in video) return video.requestVideoFrameCallback(now => frame(now));
    requestAnimationFrame(function tick(now) {
        if (!measuring) return;
        if (video.currentTime === lastMediaTime) return requestAnimationFrame(tick);
        lastMediaTime = video.currentTime;
        frame(now);
    });
}

async function startMeasure() {
    if (measuring) return;
    if (!stream && !(await requestCamera())) return;
    convo = true;
    await say(ASK);
    measuring = true; resetRun(); t0 = performance.now() / 1000;
    $("modal").classList.add("on");
    if (video.readyState < 2) await new Promise(r => video.addEventListener("loadeddata", r, { once: true }));
    drawGuide();
    $("measure").disabled = true;
    nextFrame();
}

function stopMeasure() {
    measuring = false;
    $("modal").classList.remove("on");
    $("measure").disabled = false;
}

async function finish() {
    stopMeasure();
    let r;
    if (run.valid_s < NEED_S) r = { ok: false, reason: "không thấy khuôn mặt đủ lâu" };
    else r = RPPG.estimate(run.samples);
    console.log("ket qua do", r);
    window.lastResult = r;
    if (!r.ok) {
        await say(`Cháu chưa đo được ạ, vì ${r.reason}. ${ADVICE} Bác có muốn đo lại không ạ?`);
        offered = true;
    } else {
        const hr = r.heart_rate_bpm, rr = r.breathing_rate_per_min;
        let text = `Cháu đo xong rồi ạ. Nhịp tim của bác khoảng ${hr} lần mỗi phút`;
        text += rr ? `, nhịp thở khoảng ${rr} lần mỗi phút.` : `. Cháu chưa đo được nhịp thở.`;
        if (hr < 60 || hr > 100) text += ` Nhịp tim này hơi ${hr > 100 ? "cao" : "thấp"} hơn mức thường gặp, bác nghỉ ngơi rồi đo lại nhé.`;
        await say(`${text} ${NOTE}`);
    }
    chips(offered ? ["Có, đo lại", "Không cần"] : ["Đo lại", "Tôi hơi mệt", "Tạm biệt"]);
    listen();
}

// ---------- nut ----------
async function begin() {
    convo = true;
    await say(GREET);
    chips(MAIN_CHIPS);
    listen();
}
$("measure").onclick = () => { stopListening(); userSays("Đo nhịp tim cho tôi"); };
$("switch").onclick = $("switch2").onclick = switchCamera;
$("mic").onclick = () => {
    if (listening) { convo = false; stopListening(); return; }
    if (!micOk) return requestMic().then(ok => ok && listen(true));
    listen(true);
};
$("cancel").onclick = () => {
    stopMeasure();
    say("Dạ cháu đã dừng đo. Khi nào bác muốn đo thì nói với cháu nhé.").then(() => { chips(MAIN_CHIPS); listen(); });
};
$("voice").onclick = () => {
    voiceOn = !voiceOn;
    $("voice").textContent = voiceOn ? "🔊" : "🔇";
    if (!voiceOn && "speechSynthesis" in window) speechSynthesis.cancel();
};
$("start").onclick = async () => {
    $("splash").style.display = "none";
    const cam = await requestCamera();               // xin quyen camera, roi micro, truoc tien
    await requestMic();
    if (cam) begin();
};
