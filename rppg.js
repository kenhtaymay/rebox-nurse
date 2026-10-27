// rPPG trong trinh duyet - ban JS cua virtual-nurse/dsp.py (POS + pho "lam trang" 1/f), cung nguong.
// Dung duoc ca trong trinh duyet (window.RPPG) va node (require) de test.
(function (root) {
    "use strict";
    const HR_LO = 0.7, HR_HI = 4.0;          // 42 - 240 lan/phut
    const RR_LO = 0.13, RR_HI = 0.55;        // ~8 - 33 lan/phut
    const HR_CTX = [0.2, 4.5], RR_CTX = [0.05, 1.0];
    const SNR_MIN = 9.0, SNR_HIGH = 15.0, RR_SNR_MIN = 12.0, PEAK_HW = 0.1, EDGE_HZ = 0.1, BIN_HZ = 1 / 60;
    // vung da: YCrCb giong cv2.inRange([0,133,77],[255,173,127])
    function isSkin(r, g, b) {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cr = (r - y) * 0.713 + 128, cb = (b - y) * 0.564 + 128;
        return cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127;
    }

    // trung binh RGB cua cac diem da trong ROI; tra ve {rgb, skin} (skin = ti le diem da)
    function roiMean(data, W, x0, y0, x1, y1) {
        let r = 0, g = 0, b = 0, n = 0, tot = 0;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const i = (y * W + x) * 4;
                tot++;
                if (isSkin(data[i], data[i + 1], data[i + 2])) {
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
                }
            }
        }
        return { rgb: n ? [r / n, g / n, b / n] : null, skin: tot ? n / tot : 0 };
    }

    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };

    // samples [{t (giay), rgb:[r,g,b]}] -> luoi deu fs (noi suy tuyen tinh)
    function resample(samples, fs) {
        const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
        const n = Math.floor((t1 - t0) * fs) + 1, out = [];
        let j = 0;
        for (let k = 0; k < n; k++) {
            const t = t0 + k / fs;
            while (j < samples.length - 2 && samples[j + 1].t < t) j++;
            const a = samples[j], b = samples[j + 1] || a;
            const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
            out.push([0, 1, 2].map(c => a.rgb[c] + (b.rgb[c] - a.rgb[c]) * u));
        }
        return out;
    }

    // POS (Wang et al., IEEE TBME 2017), cong chong cua so 1.6 s
    function pos(rgb, fs) {
        const n = rgb.length, L = Math.max(Math.round(1.6 * fs), 8), H = new Float64Array(n);
        for (let m = 0; m + L <= n; m++) {
            const mu = [0, 1, 2].map(c => { let s = 0; for (let i = m; i < m + L; i++) s += rgb[i][c]; return s / L + 1e-9; });
            const s0 = [], s1 = [];
            for (let i = m; i < m + L; i++) {
                const r = rgb[i][0] / mu[0], g = rgb[i][1] / mu[1], b = rgb[i][2] / mu[2];
                s0.push(g - b); s1.push(-2 * r + g + b);
            }
            const a = std(s0) / (std(s1) + 1e-9), h = s0.map((v, i) => v + a * s1[i]), hm = mean(h);
            for (let i = 0; i < L; i++) H[m + i] += h[i] - hm;
        }
        return Array.from(H);
    }

    function detrend(x) {                       // bo xu huong tuyen tinh
        const n = x.length, tm = (n - 1) / 2, xm = mean(x);
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) { num += (i - tm) * (x[i] - xm); den += (i - tm) * (i - tm); }
        const k = den ? num / den : 0;
        return x.map((v, i) => v - xm - k * (i - tm));
    }

    function fftPower(x, nfft) {                // |FFT|^2, radix-2, x da nhan cua so
        const re = new Float64Array(nfft), im = new Float64Array(nfft);
        re.set(x.slice(0, nfft));
        for (let i = 1, j = 0; i < nfft; i++) {
            let bit = nfft >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
        }
        for (let len = 2; len <= nfft; len <<= 1) {
            const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < nfft; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const a = i + k, b = a + len / 2;
                    const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
                }
            }
        }
        const p = new Float64Array(nfft / 2 + 1);
        for (let k = 0; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k] + 1e-30;
        return p;
    }

    function linfit(xs, ys) {
        const xm = mean(xs), ym = mean(ys);
        let num = 0, den = 0;
        for (let i = 0; i < xs.length; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
        const k = den ? num / den : 0;
        return [k, ym - k * xm];
    }

    // [nhip/phut, snr] cua dinh manh nhat trong [lo, hi] sau khi chia bo xu huong 1/f (nhu dsp.whitened_peak)
    function whitenedPeak(x, fs, lo, hi, ctx) {
        const n = x.length, xm = mean(x);
        const w = x.map((v, i) => (v - xm) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))));
        let nfft = 1;
        while (nfft < Math.max(n, fs / BIN_HZ)) nfft <<= 1;
        const P = fftPower(w, nfft), df = fs / nfft;
        const idx = [];
        for (let k = 1; k < P.length; k++) if (k * df >= ctx[0] && k * df <= ctx[1]) idx.push(k);
        const lf = idx.map(k => Math.log(k * df)), lp = idx.map(k => Math.log(P[k]));
        let keep = idx.map(() => true), coef = [0, 0];
        for (let it = 0; it < 2; it++) {
            coef = linfit(lf.filter((_, i) => keep[i]), lp.filter((_, i) => keep[i]));
            keep = lp.map((v, i) => v - (coef[0] * lf[i] + coef[1]) < Math.log(8));
        }
        const white = k => P[k] / Math.exp(coef[0] * Math.log(Math.max(k, 1) * df) + coef[1]);
        let best = -1, bw = -1;
        for (let k = 1; k < P.length; k++) {
            const f = k * df;
            if (f >= lo && f <= hi && white(k) > bw) { bw = white(k); best = k; }
        }
        if (best < 0) return [0, 0];
        let f = best * df;
        if (best > 0 && best < P.length - 1) {                       // noi suy dinh parabol
            const a = P[best - 1], b = P[best], c = P[best + 1], d = a - 2 * b + c;
            if (d < 0) f += 0.5 * (a - c) / d * df;
        }
        let ns = 0, nn = 0;
        for (let k = 1; k < P.length; k++) {
            const fk = k * df;
            if (fk >= lo && fk <= hi && Math.abs(fk - best * df) > PEAK_HW) { ns += white(k); nn++; }
        }
        return [f * 60, bw / (nn ? ns / nn : 1e-9)];
    }

    // samples lien tuc (da loc khung hop le) -> ket qua giong measure.MeasureSession.result()
    function estimate(samples) {
        if (samples.length < 20) return { ok: false, reason: "không đủ dữ liệu" };
        const dur = samples[samples.length - 1].t - samples[0].t;
        const fs = Math.min(30, Math.max(8, (samples.length - 1) / dur));
        const rgb = resample(samples, fs);
        const [hr, snr] = whitenedPeak(detrend(pos(rgb, fs)), fs, HR_LO, HR_HI, HR_CTX);
        if (snr < SNR_MIN || hr <= (HR_LO + EDGE_HZ) * 60)
            return { ok: false, reason: "ánh sáng/tín hiệu yếu", snr, fs };
        const [rr, rsnr] = whitenedPeak(detrend(rgb.map(v => v[1])), fs, RR_LO, RR_HI, RR_CTX);
        return {
            ok: true, heart_rate_bpm: Math.round(hr),
            breathing_rate_per_min: rsnr >= RR_SNR_MIN ? Math.round(rr) : null,
            confidence: snr >= SNR_HIGH ? "cao" : "trung bình", snr, rr_snr: rsnr, fs,
        };
    }

    const api = { isSkin, roiMean, estimate, pos, whitenedPeak };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.RPPG = api;
})(typeof window !== "undefined" ? window : globalThis);
