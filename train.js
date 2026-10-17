// Домашние тренировки: библиотека упражнений, рисованные иллюстрации и сборка плана.
// Модуль не зависит от Firebase и от остального приложения: только данные и чистые функции.

/* ================= Рисунки: скелет-человечек ================= */
// Углы в градусах: 0 = вниз, 90 = вперёд (вправо), 180 = вверх, −90 = назад (влево).
const L = { torso: 34, neck: 8, head: 7.5, ua: 19, fa: 17, hand: 4, th: 28, sh: 27, ft: 11 };
const rad = (d) => (d * Math.PI) / 180;
const vec = (a, len) => [Math.sin(rad(a)) * len, Math.cos(rad(a)) * len];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];

// Двухзвенная обратная кинематика: из точки p0 до цели tgt, звенья l1 и l2.
// b: куда смотрит сустав (колено, локоть): "f" вперёд, "b" назад, "u" вверх, "d" вниз
function ik(p0, tgt, l1, l2, b) {
  let dx = tgt[0] - p0[0], dy = tgt[1] - p0[1];
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.01, min = Math.abs(l1 - l2) + 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  if (d < min) { dx *= min / d; dy *= min / d; d = min; }
  const phi = Math.atan2(dy, dx);
  const al = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const c1 = [p0[0] + l1 * Math.cos(phi + al), p0[1] + l1 * Math.sin(phi + al)];
  const c2 = [p0[0] + l1 * Math.cos(phi - al), p0[1] + l1 * Math.sin(phi - al)];
  const pick = { f: c1[0] >= c2[0] ? c1 : c2, b: c1[0] <= c2[0] ? c1 : c2, u: c1[1] <= c2[1] ? c1 : c2, d: c1[1] >= c2[1] ? c1 : c2 }[b || "f"];
  return [pick, [p0[0] + dx, p0[1] + dy]];
}

// Одна рука или нога: либо углы (FK), либо цель (IK)
function limb(root, l1, l2, fk, iks) {
  if (iks) {
    const [j, e] = ik(root, add(root, [iks[0], iks[1]]), l1, l2, iks[2]);
    return [j, e];
  }
  const j = add(root, vec(fk[0], l1));
  return [j, add(j, vec(fk[1], l2))];
}

function joints(p, t) {
  const hip = [0, 0];
  const sho = add(hip, vec(t, L.torso));
  const hd = p.hd == null ? t : p.hd;
  const head = add(sho, vec(hd, L.neck + L.head));
  const legAng = (a) => a;
  const thL = p.l || [0, 0];
  const [knee, ankle] = limb(hip, L.th, L.sh, p.lin ? [t - 180, t - 180 + (p.sb || 0)] : legAng(thL), p.la);
  const toe = add(ankle, vec(p.f == null ? 90 : p.f, L.ft));
  const [elbow, wrist] = limb(sho, L.ua, L.fa, p.a || [0, 0], p.aw);
  const hand = add(wrist, vec((p.a ? p.a[1] : 0) + (p.hdir || 0), L.hand));
  const farLeg = p.Llin ? limb(hip, L.th, L.sh, [t - 180, t - 180], null) : p.LA || p.L ? limb(hip, L.th, L.sh, p.L || [0, 0], p.LA) : [knee, ankle];
  const farFoot = add(farLeg[1], vec(p.F == null ? (p.f == null ? 90 : p.f) : p.F, L.ft));
  const farArm = p.AW || p.A ? limb(sho, L.ua, L.fa, p.A || [0, 0], p.AW) : [elbow, wrist];
  const farHand = add(farArm[1], vec(p.A ? p.A[1] : (p.a ? p.a[1] : 0), L.hand));
  return { hip, sho, head, knee, ankle, toe, elbow, wrist, hand, kneeF: farLeg[0], ankleF: farLeg[1], toeF: farFoot, elbowF: farArm[0], wristF: farArm[1], handF: farHand, far: !!(p.L || p.LA || p.Llin || p.A || p.AW) };
}

// Поза с подгонкой: угол корпуса подбирается так, чтобы две точки были на одной высоте (руки и носки на полу)
function solve(p) {
  if (!p.fit) return joints(p, p.t);
  const [n1, n2] = p.fit;
  const f = (t) => { const j = joints(p, t); return j[n1][1] - j[n2][1]; };
  let lo = p.t - 45, hi = p.t + 45, flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return joints(p, p.t);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return joints(p, (lo + hi) / 2);
}

const CLEAR = { hip: 4.5, sho: 4.5, head: 7.5, knee: 2.8, ankle: 2.8, toe: 2.8, elbow: 2.8, wrist: 2.8, hand: 2.8, kneeF: 2.8, ankleF: 2.8, toeF: 2.8, elbowF: 2.8, wristF: 2.8, handF: 2.8 };

// Ставит фигуру на «пол»: самая низкая точка получает y = 0; по горизонтали привязка к якорной точке
function layout(p, anchor) {
  const j = solve(p);
  const names = Object.keys(CLEAR).filter((k) => j.far || !/F$/.test(k));
  let low = -1e9;
  for (const k of names) low = Math.max(low, j[k][1] + CLEAR[k]);
  const ax = j[anchor || "ankle"][0];
  const dy = p.hy != null ? p.hy - j.hand[1] : -low - (p.lift || 0);
  const out = {};
  for (const k of Object.keys(j)) if (Array.isArray(j[k])) out[k] = [j[k][0] - ax, j[k][1] + dy];
  out.far = j.far;
  return out;
}

const W = 200, H = 160, GROUND = 142;
const BAND_COL = { tube: "#E0483E", loop: "#2E9E5B", tubeLight: "#F2B705", tubeHeavy: "#3B6FD0", cable: "#8A94A0" };

const pl = (pts) => pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");

function figureSvg(j, m) {
  // m: смещение панели
  const T = (q) => [q[0] + m[0], q[1] + m[1]];
  const P = {};
  for (const k of Object.keys(j)) if (Array.isArray(j[k])) P[k] = T(j[k]);
  const body = "var(--text)", far = "var(--muted-2)";
  let s = "";
  if (j.far) {
    s += `<polyline points="${pl([P.hip, P.kneeF, P.ankleF, P.toeF])}" fill="none" stroke="${far}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<polyline points="${pl([P.sho, P.elbowF, P.wristF, P.handF])}" fill="none" stroke="${far}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  s += `<polyline points="${pl([P.hip, P.knee, P.ankle, P.toe])}" fill="none" stroke="${body}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<line x1="${P.hip[0].toFixed(1)}" y1="${P.hip[1].toFixed(1)}" x2="${P.sho[0].toFixed(1)}" y2="${P.sho[1].toFixed(1)}" stroke="${body}" stroke-width="9" stroke-linecap="round"/>`;
  s += `<polyline points="${pl([P.sho, P.elbow, P.wrist, P.hand])}" fill="none" stroke="${body}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<circle cx="${P.head[0].toFixed(1)}" cy="${P.head[1].toFixed(1)}" r="${L.head}" fill="${body}"/>`;
  return s;
}

function arrowSvg(a, b, col, op) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  if (d < 7) return "";
  const ux = dx / d, uy = dy / d;
  const e = [b[0] - ux * 1, b[1] - uy * 1];
  const h1 = [e[0] - ux * 7 - uy * 4, e[1] - uy * 7 + ux * 4], h2 = [e[0] - ux * 7 + uy * 4, e[1] - uy * 7 - ux * 4];
  return `<g opacity="${op}"><line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${(e[0] - ux * 5).toFixed(1)}" y2="${(e[1] - uy * 5).toFixed(1)}" stroke="${col}" stroke-width="2.4" stroke-dasharray="4 3" stroke-linecap="round"/><polygon points="${pl([e, h1, h2])}" fill="${col}"/></g>`;
}

// Принадлежности: резинка, гантели, дверь, скамья, турник, коврик, дорожка
function propsSvg(ex, vk, fr, P, m) {
  let s = "";
  const g = (x, y) => [x + m[0], y + m[1]];
  const band = ex.band;
  const useBand = vk === "band" && band;
  const useCable = vk === "cable" && band;
  const col = useCable ? BAND_COL.cable : (band && band.col) || BAND_COL.tube;
  // дверной косяк/стойка
  const doorX = (b) => (b.x === "L" ? 16 : 184);
  if ((useBand || useCable) && band.t === "door") {
    const x = doorX(band), ay = GROUND - band.h * 118;
    s += `<line x1="${x}" y1="${GROUND - 126}" x2="${x}" y2="${GROUND}" stroke="var(--muted-2)" stroke-width="5" stroke-linecap="round" opacity=".55"/>`;
    s += `<circle cx="${x}" cy="${ay.toFixed(1)}" r="4.5" fill="${col}" stroke="var(--card)" stroke-width="1.5"/>`;
  }
  const anchorPt = () => {
    if (band.t === "door") return [doorX(band), GROUND - band.h * 118];
    if (band.t === "foot") return [P.ankle[0], GROUND - 2];
    if (band.t === "toe") return [P.toe[0], P.toe[1]];
    if (band.t === "ankle") return [P.ankle[0], P.ankle[1]];
    if (band.t === "ankleF") return [P.ankleF[0], P.ankleF[1]];
    return null;
  };
  if (useBand || useCable) {
    const a = anchorPt();
    if (a) {
      const hs = band.hands === "both" ? [P.hand, P.handF] : [P.hand];
      const seen = new Set();
      for (const h of hs) {
        const key = `${h[0].toFixed(0)}:${h[1].toFixed(0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${h[0].toFixed(1)}" y2="${h[1].toFixed(1)}" stroke="${col}" stroke-width="${useCable ? 2 : 3}" stroke-linecap="round"/>`;
      }
      if (band.t === "foot") s += `<path d="M ${(a[0] - 9).toFixed(1)} ${GROUND + 0} h 20" stroke="${col}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
      if (band.t === "toe" || band.t === "ankle" || band.t === "ankleF") s += `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="3.4" fill="${col}"/>`;
    }
    if (!band.noHandle) s += `<rect x="${(P.hand[0] - 4).toFixed(1)}" y="${(P.hand[1] - 4).toFixed(1)}" width="8" height="8" rx="2.5" fill="${col}"/>`;
  }
  if (vk === "db") {
    for (const h of [P.hand]) s += `<g><rect x="${(h[0] - 8).toFixed(1)}" y="${(h[1] - 2.6).toFixed(1)}" width="16" height="5.2" rx="2" fill="var(--muted)"/><rect x="${(h[0] - 10).toFixed(1)}" y="${(h[1] - 5).toFixed(1)}" width="5" height="10" rx="2" fill="var(--text)" opacity=".85"/><rect x="${(h[0] + 5).toFixed(1)}" y="${(h[1] - 5).toFixed(1)}" width="5" height="10" rx="2" fill="var(--text)" opacity=".85"/></g>`;
  }
  for (const pr of ex.props || []) {
    if (pr.t === "box") {
      const x = pr.x + m[0], y = GROUND - pr.h;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pr.w}" height="${pr.h}" rx="3" fill="var(--accent)" opacity=".28"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pr.w}" height="4" rx="2" fill="var(--accent)" opacity=".7"/>`;
    }
    if (pr.t === "bar") {
      const y = GROUND - pr.h;
      s += `<line x1="${(pr.x + m[0]).toFixed(1)}" y1="${y}" x2="${(pr.x + pr.w + m[0]).toFixed(1)}" y2="${y}" stroke="var(--text)" stroke-width="4" stroke-linecap="round" opacity=".75"/><line x1="${(pr.x + m[0] + 2).toFixed(1)}" y1="${y}" x2="${(pr.x + m[0] + 2).toFixed(1)}" y2="${GROUND}" stroke="var(--muted-2)" stroke-width="3" opacity=".35"/>`;
    }
    if (pr.t === "wall") {
      const x = pr.x + m[0];
      s += `<line x1="${x.toFixed(1)}" y1="${GROUND - 128}" x2="${x.toFixed(1)}" y2="${GROUND}" stroke="var(--muted-2)" stroke-width="6" stroke-linecap="round" opacity=".45"/>`;
    }
    if (pr.t === "belt") {
      const x = pr.x + m[0];
      s += `<rect x="${x.toFixed(1)}" y="${GROUND - 3}" width="${pr.w}" height="7" rx="3.5" fill="var(--muted)" opacity=".55"/><line x1="${(x + pr.w - 4).toFixed(1)}" y1="${GROUND - 3}" x2="${(x + pr.w - 4).toFixed(1)}" y2="${GROUND - 58}" stroke="var(--muted)" stroke-width="3.5" stroke-linecap="round" opacity=".55"/>`;
    }
  }
  return s;
}

// Две панели: «1 — исходное положение», «2 — конечное»
export function exerciseSvg(ex, vk) {
  const anchor = ex.anchor || "ankle";
  const A = ex.frames.map((fr) => layout(fr, anchor));
  // общий центр по горизонтали
  let minX = 1e9, maxX = -1e9;
  for (const j of A) for (const k of Object.keys(j)) if (Array.isArray(j[k])) { minX = Math.min(minX, j[k][0] - 8); maxX = Math.max(maxX, j[k][0] + 8); }
  const shift = ex.shift == null ? 0 : ex.shift;
  const m = [W / 2 - (minX + maxX) / 2 + shift, GROUND];
  let out = `<svg viewBox="0 0 ${W * 2 + 8} ${H}" class="ex-svg" role="img" aria-label="${ex.name}: два положения">`;
  A.forEach((j, i) => {
    const ox = i * (W + 8);
    out += `<g transform="translate(${ox} 0)"><rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="var(--field)"/>`;
    if (ex.mat) out += `<rect x="${Math.max(8, m[0] + minX - 14).toFixed(1)}" y="${GROUND}" width="${Math.min(184, maxX - minX + 28).toFixed(1)}" height="6" rx="3" fill="var(--accent)" opacity=".4"/>`;
    else out += `<line x1="10" y1="${GROUND}" x2="190" y2="${GROUND}" stroke="var(--line)" stroke-width="2.5" stroke-linecap="round"/>`;
    const P = {};
    for (const k of Object.keys(j)) if (Array.isArray(j[k])) P[k] = [j[k][0] + m[0], j[k][1] + m[1]];
    out += propsSvg(ex, vk, i, P, m);
    out += figureSvg(j, m);
    for (const trk of ex.track || []) {
      const a = A[0][trk], b = A[1][trk];
      if (!a || !b) continue;
      const pa = [a[0] + m[0], a[1] + m[1]], pb = [b[0] + m[0], b[1] + m[1]];
      out += i === 0 ? arrowSvg(pa, pb, "var(--accent)", 0.95) : arrowSvg(pb, pa, "var(--accent)", 0.45);
    }
    const bad = ex.badSecond && i === 1;
    if (bad) out += `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="13" fill="none" stroke="var(--red)" stroke-width="2.5"/>`;
    if (ex.labels) out += `<text x="${W / 2 + 14}" y="20.5" text-anchor="middle" font-size="12" font-weight="700" fill="${bad ? "var(--red)" : "var(--accent)"}">${ex.labels[i]}</text>`;
    out += `<circle cx="16" cy="16" r="10" fill="${bad ? "var(--red)" : "var(--accent)"}"/><text x="16" y="20.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${i + 1}</text></g>`;
  });
  return out + "</svg>";
}


/* ================= Справочники ================= */
export const PLACES = [{ v: "home", t: "Дома" }, { v: "outdoor", t: "На улице" }, { v: "gym", t: "В зале" }];
export const BAND_COLORS = [
  { id: "yellow", t: "Жёлтая", hex: "#F2C230" },
  { id: "red", t: "Красная", hex: "#E5484D" },
  { id: "blue", t: "Синяя", hex: "#3E7BE0" },
  { id: "green", t: "Зелёная", hex: "#2FA866" },
  { id: "black", t: "Чёрная", hex: "#2B2B2B" },
];
// Ориентир сопротивления трубок по цветам: типовой набор из 5 трубок «до 100 фунтов» (жёлтая 10, красная 15, синяя 20, зелёная 25, чёрная 30 фунтов). У разных продавцов цвета могут идти иначе, вес можно поправить.
export const BAND_DEFAULT_KG = { yellow: 4.5, red: 6.8, blue: 9.1, green: 11.3, black: 13.6 };
export const FEEL = ["", "Очень легко", "Легко", "Нормально", "Тяжело", "Очень тяжело"];
export const EQUIP = [
  { id: "mat", t: "Коврик" },
  { id: "tube", t: "Трубчатые эспандеры с ручками" },
  { id: "anchor", t: "Дверной якорь для эспандера" },
  { id: "loop", t: "Длинные резиновые петли" },
  { id: "dumbbell", t: "Гантели" },
  { id: "bar", t: "Турник" },
  { id: "bench", t: "Скамья, крепкий стул или ступенька" },
  { id: "treadmill", t: "Беговая дорожка" },
  { id: "cable", t: "Блочный тренажёр" },
];
export const EQUIP_BY_PLACE = {
  home: ["mat", "tube", "anchor", "loop", "dumbbell", "bar", "bench", "treadmill"],
  outdoor: ["mat", "tube", "loop", "dumbbell", "bar", "bench"],
  gym: ["mat", "dumbbell", "bench", "bar", "cable", "tube", "loop", "treadmill"],
};
export const DEFAULT_EQUIP = {
  home: ["mat", "tube", "anchor", "loop", "treadmill"],
  outdoor: ["bar", "bench"],
  gym: ["mat", "dumbbell", "bench", "bar", "cable", "treadmill"],
};
export const LIMITS = [{ id: "knees", t: "Колени" }, { id: "back", t: "Поясница" }, { id: "shoulders", t: "Плечи" }, { id: "wrists", t: "Запястья" }];
export const TRAIN_LEVELS = [{ v: "n", t: "Новичок" }, { v: "m", t: "Средний" }, { v: "a", t: "Опытный" }];
export const TIMES = [15, 20, 30, 45, 60];
export const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
export const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const DEFAULT_DAYS = [0, 2, 4];

/* ================= Упражнения ================= */
// need: все элементы обязательны; внутри элемента «a|b» значит «любое из». variants идут по предпочтению.
// frames: два кадра (старт, финиш); frameV: другие кадры для варианта.
const STAND = { t: 180, la: [0, 55, "f"] };
const FLOOR_LEG = { la: [28, 2, "u"], f: 90 };

export const EXERCISES = {
  /* ---------- Ноги и ягодицы ---------- */
  squat: {
    name: "Приседания", muscles: "Квадрицепсы и ягодицы", reps: [12, 15], rest: 40, avoid: ["knees"],
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелью у груди", cue: "Держите гантель двумя руками у груди." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногами", cue: "Встаньте на середину петли (или на трубку эспандера), ручки или концы держите у плеч." },
      { k: "bw", need: [], label: "Без веса", cue: "Руки вытяните вперёд для равновесия." },
    ],
    band: { t: "foot", col: BAND_COL.loop }, track: ["hip"],
    frames: [{ ...STAND, a: [90, 90] }, { t: 142, la: [20, 36, "f"], a: [90, 90] }],
    frameV: {
      band: [{ ...STAND, aw: [9, -1, "d"] }, { t: 142, la: [20, 36, "f"], aw: [9, -1, "d"] }],
      db: [{ ...STAND, aw: [12, 6, "d"] }, { t: 142, la: [20, 36, "f"], aw: [12, 6, "d"] }],
    },
    steps: [
      "Встаньте, стопы на ширине плеч, носки слегка развёрнуты в стороны.",
      "Отведите таз назад и вниз, как будто садитесь на стул. Спина прямая, грудь раскрыта.",
      "Опуститесь до положения, когда бёдра примерно параллельны полу (или насколько комфортно).",
      "Выдохните и встаньте, надавливая на всю стопу.",
    ],
    mistakes: ["Колени заваливаются внутрь: направляйте их по линии носков.", "Пятки отрываются от пола: вес на всей стопе.", "Округляется поясница: смотрите вперёд, держите грудь высоко."],
  },
  lunge: {
    name: "Выпады назад", muscles: "Ягодицы и квадрицепсы", reps: [8, 12], side: true, rest: 40, avoid: ["knees"],
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями в руках", cue: "Гантели держите вдоль тела." },
      { k: "bw", need: [], label: "Без веса", cue: "Руки на поясе или вдоль тела." },
    ],
    track: ["hip"],
    frames: [{ ...STAND, a: [0, 0] }, { t: 180, la: [26, 28, "f"], LA: [-26, 25, "d"], F: 40, a: [0, 0] }],
    steps: [
      "Встаньте прямо, стопы на ширине таза.",
      "Сделайте широкий шаг назад и опуститесь, пока оба колена не согнутся примерно до 90°.",
      "Переднее колено над стопой, корпус прямой, взгляд вперёд.",
      "Оттолкнитесь передней ногой и вернитесь в стойку. Все повторения на одну ногу, затем на другую.",
    ],
    mistakes: ["Слишком короткий шаг: нагрузка уходит в колено.", "Корпус заваливается вперёд.", "Заднее колено ударяется об пол: опускайтесь плавно."],
  },
  rdl: {
    name: "Румынская тяга", muscles: "Задняя поверхность бёдер и ягодицы", reps: [10, 15], rest: 45, avoid: ["back"],
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями", cue: "Гантели скользят вдоль ног." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногами", cue: "Встаньте на середину петли (или на трубку), концы держите в руках." },
      { k: "bw", need: [], label: "Без веса (наклоны)", cue: "Руки скользят вдоль ног или скрещены на груди." },
    ],
    band: { t: "foot", col: BAND_COL.loop }, track: ["hand"],
    frames: [{ ...STAND, a: [0, 0] }, { t: 112, la: [14, 52, "f"], a: [0, 0] }],
    steps: [
      "Встаньте, стопы на ширине таза, колени слегка согнуты.",
      "Отведите таз назад, наклоняя корпус вперёд. Спина прямая, руки скользят вдоль ног.",
      "Опуститесь до растяжения в задней поверхности бёдер (обычно до уровня колен).",
      "Сожмите ягодицы и вернитесь в стойку.",
    ],
    mistakes: ["Округлённая спина: смотрите на пол в метре-двух перед собой, лопатки сведены.", "Приседание вместо наклона: таз идёт назад, а не вниз.", "Рывок при подъёме."],
  },
  bridge: {
    name: "Ягодичный мостик", muscles: "Ягодицы и задняя поверхность бёдер", reps: [12, 18], rest: 35, floor: true, mat: true,
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "На верхней точке сделайте паузу 1–2 секунды." }],
    anchor: "ankle", track: ["hip"],
    frames: [
      { t: -90, ...FLOOR_LEG, hd: -100, a: [90, 90] },
      { t: -50, la: [26, 22, "u"], f: 90, hd: -100, a: [90, 90], fit: ["sho", "ankle"] },
    ],
    steps: [
      "Лягте на спину, колени согнуты, стопы на ширине таза, пятки близко к ягодицам. Руки вдоль тела.",
      "Выдохните, сожмите ягодицы и поднимите таз, пока плечи, таз и колени не окажутся на одной линии.",
      "Задержитесь на 1–2 секунды и медленно опуститесь.",
    ],
    mistakes: ["Прогиб в пояснице: не поднимайте таз выше линии «плечи — колени».", "Нагрузка уходит в спину: давите пятками и сжимайте ягодицы.", "Колени разъезжаются в стороны."],
  },
  donkey: {
    name: "Отведение ноги назад на четвереньках", muscles: "Ягодицы", reps: [10, 15], side: true, rest: 35, floor: true, mat: true, avoid: ["wrists"],
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Тянитесь пяткой, а не носком." }],
    anchor: "handF", track: ["ankle"],
    frames: [
      { t: 90, la: [-27, 28, "d"], f: -90, a: [0, 0], LA: [-27, 28, "d"], F: -90, A: [0, 0] },
      { t: 90, la: [-52, -10, "d"], f: 20, a: [0, 0], LA: [-27, 28, "d"], F: -90, A: [0, 0] },
    ],
    steps: [
      "Встаньте на четвереньки: ладони под плечами, колени под тазом, спина ровная.",
      "Не прогибая поясницу, отведите одну ногу назад и вверх до линии тела.",
      "Сожмите ягодицу наверху и медленно верните колено вниз, не касаясь пола.",
      "Все повторения на одну ногу, затем на другую.",
    ],
    mistakes: ["Поясница прогибается: поднимайте ногу только до линии спины.", "Корпус раскачивается: напрягите пресс и держите таз ровно."],
  },
  calf: {
    name: "Подъёмы на носки", muscles: "Икры", reps: [15, 20], rest: 30,
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями в руках", cue: "Гантели вдоль тела." },
      { k: "bw", need: [], label: "Без веса", cue: "Можно придерживаться за стену для равновесия." },
    ],
    track: ["hip"],
    frames: [{ ...STAND, a: [0, 0] }, { ...STAND, f: 25, a: [0, 0] }],
    steps: ["Встаньте прямо, стопы на ширине таза.", "Медленно поднимитесь на носки как можно выше.", "Задержитесь на секунду и плавно опуститесь."],
    mistakes: ["Стопы заваливаются наружу: опора на большой палец.", "Рывки вместо плавного движения."],
  },
  stepup: {
    name: "Подъёмы на скамью", muscles: "Ягодицы и квадрицепсы", reps: [8, 12], side: true, rest: 40, avoid: ["knees"],
    variants: [
      { k: "db", need: ["bench", "dumbbell"], label: "С гантелями в руках", cue: "Гантели вдоль тела." },
      { k: "bw", need: ["bench"], label: "Без веса", cue: "Руки на поясе." },
    ],
    props: [{ t: "box", x: -10, w: 40, h: 24 }], track: ["hip"],
    frames: [
      { t: 178, la: [18, 26, "f"], LA: [-2, 50, "f"], F: 90, a: [0, 0] },
      { t: 180, la: [0, 55, "f"], LA: [14, 30, "f"], F: 100, a: [0, 0], lift: 24 },
    ],
    steps: [
      "Встаньте перед устойчивой скамьёй или ступенькой высотой примерно до колена.",
      "Поставьте на неё одну ногу всей стопой и, надавив пяткой, поднимитесь, подтянув вторую ногу.",
      "Медленно опуститесь обратно, контролируя движение.",
      "Все повторения на одну ногу, затем на другую.",
    ],
    mistakes: ["Отталкивание задней ногой: работайте ногой на опоре.", "Неустойчивая опора: проверьте, что скамья не скользит."],
  },

  /* ---------- Спина и руки ---------- */
  row: {
    name: "Тяга сидя к поясу", muscles: "Широчайшие и середина спины", reps: [12, 15], rest: 40, floor: true, mat: true,
    variants: [
      { k: "band", need: ["loop|tube"], label: "С резинкой на стопах", cue: "Зацепите середину петли (или трубку) за стопы, концы держите в руках." },
      { k: "cable", need: ["cable"], label: "На блочном тренажёре", cue: "Сидя лицом к блоку, рукоять к поясу." },
    ],
    band: { t: "toe", col: BAND_COL.loop }, anchor: "ankle", track: ["hand"],
    frames: [
      { t: 180, la: [54, 2, "u"], f: 100, a: [90, 90], hd: 180 },
      { t: 174, la: [54, 2, "u"], f: 100, aw: [6, 30, "b"], hd: 174 },
    ],
    steps: [
      "Сядьте на пол, ноги вытяните вперёд, колени слегка согнуты. Резинка зацеплена за стопы.",
      "Спина прямая, руки вытянуты вперёд с ручками (концами резинки).",
      "Выдохните: сведите лопатки и потяните руки к поясу, локти идут вдоль тела.",
      "Задержитесь на секунду и медленно вернитесь.",
    ],
    mistakes: ["Раскачивание корпусом: двигаются только руки и лопатки.", "Плечи ползут к ушам: опустите их вниз.", "Круглая спина."],
  },
  bentrow: {
    name: "Тяга в наклоне", muscles: "Спина и задние пучки плеч", reps: [10, 14], rest: 40, avoid: ["back"],
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями", cue: "Гантели в руках, ладони смотрят друг на друга." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногами", cue: "Встаньте на середину петли (или трубку), концы в руках." },
    ],
    band: { t: "foot", col: BAND_COL.loop }, track: ["hand"],
    frames: [
      { t: 128, la: [8, 52, "f"], a: [0, 0], hd: 150 },
      { t: 128, la: [8, 52, "f"], aw: [-14, 12, "u"], hd: 150 },
    ],
    steps: [
      "Встаньте на резинку (или возьмите гантели), колени слегка согнуты.",
      "Наклоните корпус вперёд примерно на 45°, спина прямая, руки свисают.",
      "Потяните локти назад к поясу, сводя лопатки.",
      "Медленно опустите руки.",
    ],
    mistakes: ["Округлая спина или подъём корпуса при каждом повторе.", "Тянут только руки, а лопатки не работают."],
  },
  pulldown: {
    name: "Тяга сверху вниз", muscles: "Широчайшие мышцы спины", reps: [12, 15], rest: 40,
    variants: [
      { k: "band", need: ["tube", "anchor"], label: "С эспандером в двери", cue: "Якорь закрепите вверху двери. Дверь должна открываться от вас и быть плотно закрыта (лучше на замок)." },
      { k: "cable", need: ["cable"], label: "На блочном тренажёре", cue: "Верхний блок, хват чуть шире плеч." },
    ],
    band: { t: "door", x: "R", h: 0.95, col: BAND_COL.tube }, anchor: "knee", track: ["hand"],
    frames: [
      { t: 180, la: [-27, 28, "d"], f: -90, aw: [20, -28, "d"], mat: true },
      { t: 174, la: [-27, 28, "d"], f: -90, aw: [10, 4, "d"] },
    ],
    steps: [
      "Закрепите эспандер вверху двери и встаньте на колени лицом к двери.",
      "Возьмите ручки, руки вытянуты вверх-вперёд.",
      "Потяните локти вниз и назад к бокам, ручки идут к груди.",
      "Медленно вернитесь, не отпуская натяжение.",
    ],
    mistakes: ["Тяга за счёт наклона корпуса назад.", "Плечи поднимаются к ушам.", "Дверь не закрыта плотно: проверьте якорь перед началом."],
  },
  facepull: {
    name: "Тяга к лицу", muscles: "Задние пучки плеч и верх спины", reps: [12, 18], rest: 35, avoid: ["shoulders"],
    variants: [
      { k: "band", need: ["tube", "anchor"], label: "С эспандером в двери", cue: "Якорь на уровне лица. Дверь плотно закрыта." },
      { k: "cable", need: ["cable"], label: "На блочном тренажёре", cue: "Блок на уровне лица, канатная рукоять." },
    ],
    band: { t: "door", x: "R", h: 0.78, col: BAND_COL.tube }, track: ["hand"],
    frames: [
      { ...STAND, t: 178, a: [90, 90] },
      { ...STAND, t: 178, aw: [8, -4, "b"] },
    ],
    steps: [
      "Закрепите эспандер на уровне лица, отойдите так, чтобы он был слегка натянут.",
      "Руки вытянуты вперёд на уровне плеч.",
      "Тяните ручки к лицу, разводя локти в стороны и вверх. Лопатки сводятся.",
      "Медленно вернитесь.",
    ],
    mistakes: ["Слишком тяжёлое сопротивление: корпус отклоняется назад.", "Локти опускаются ниже кистей."],
  },
  curl: {
    name: "Сгибания на бицепс", muscles: "Бицепсы", reps: [10, 15], rest: 35,
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями", cue: "Ладони смотрят вперёд." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногами", cue: "Встаньте на середину резинки, концы или ручки в руках." },
    ],
    band: { t: "foot", col: BAND_COL.tube }, track: ["hand"],
    frames: [{ ...STAND, a: [0, 0] }, { ...STAND, a: [0, 158] }],
    steps: [
      "Встаньте на резинку (или возьмите гантели), руки вдоль тела ладонями вперёд.",
      "Прижмите локти к корпусу и согните руки, поднимая ручки к плечам.",
      "Задержитесь на секунду и медленно опустите.",
    ],
    mistakes: ["Раскачивание корпусом: если без этого не получается, сопротивление слишком большое.", "Локти уезжают вперёд."],
  },
  triext: {
    name: "Разгибания рук над головой", muscles: "Трицепсы", reps: [10, 15], rest: 35,
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелью", cue: "Держите гантель двумя руками за головой." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногой", cue: "Встаньте на резинку одной ногой, концы за головой." },
    ],
    band: { t: "foot", col: BAND_COL.tube }, track: ["hand"],
    frames: [{ ...STAND, a: [180, -25] }, { ...STAND, a: [180, 180] }],
    steps: [
      "Поднимите руки над головой, локти согнуты, ручки (гантель) за головой.",
      "Локти направлены вверх и не разводятся в стороны.",
      "Выпрямите руки вверх, не прогибая поясницу.",
      "Медленно согните обратно.",
    ],
    mistakes: ["Локти разъезжаются в стороны.", "Прогиб в пояснице: напрягите пресс."],
  },
  pushdown: {
    name: "Разгибания рук вниз", muscles: "Трицепсы", reps: [12, 15], rest: 35,
    variants: [
      { k: "band", need: ["tube", "anchor"], label: "С эспандером в двери", cue: "Якорь вверху двери, дверь плотно закрыта." },
      { k: "cable", need: ["cable"], label: "На блочном тренажёре", cue: "Верхний блок, короткая рукоять." },
    ],
    band: { t: "door", x: "R", h: 0.95, col: BAND_COL.tube }, track: ["hand"],
    frames: [{ ...STAND, t: 178, a: [0, 92] }, { ...STAND, t: 178, a: [0, 0] }],
    steps: [
      "Закрепите эспандер высоко, встаньте лицом к двери, локти прижаты к бокам.",
      "Ручки на уровне груди, предплечья горизонтально.",
      "Разгибайте руки вниз до полного выпрямления, не отводя локти.",
      "Медленно вернитесь до угла 90° в локтях.",
    ],
    mistakes: ["Локти ходят вперёд-назад: движение должно быть только в локте.", "Наклон корпуса вперёд на каждом повторе."],
  },
  superman: {
    name: "Супермен", muscles: "Разгибатели спины и ягодицы", reps: [10, 15], rest: 30, floor: true, mat: true, avoid: ["back"],
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "На верхней точке пауза 2 секунды." }],
    anchor: "hip", track: ["hand"],
    frames: [
      { t: 90, lin: true, a: [90, 90] },
      { t: 96, la: [-52, -14, "d"], a: [104, 104], hd: 100 },
    ],
    steps: [
      "Лягте на живот, руки вытяните вперёд, ноги вместе.",
      "Одновременно приподнимите руки, грудь и ноги на несколько сантиметров.",
      "Задержитесь на 2 секунды, шея продолжает линию позвоночника.",
      "Медленно опуститесь.",
    ],
    mistakes: ["Запрокинутая голова: смотрите в пол.", "Слишком высокий подъём ведёт к перегрузке поясницы."],
  },
  birddog: {
    name: "Птица-собака", muscles: "Кор, ягодицы и спина", reps: [8, 12], side: true, rest: 30, floor: true, mat: true, avoid: ["wrists"],
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Двигайтесь медленно, таз остаётся ровным." }],
    anchor: "handF", track: ["hand", "ankleF"],
    frames: [
      { t: 90, la: [-27, 28, "d"], f: -90, a: [0, 0], LA: [-27, 28, "d"], F: -90, A: [0, 0] },
      { t: 90, la: [-27, 28, "d"], f: -90, a: [90, 90], LA: [-54, 0, "d"], F: -90, A: [0, 0] },
    ],
    steps: [
      "Встаньте на четвереньки: ладони под плечами, колени под тазом, спина ровная.",
      "Одновременно вытяните правую руку вперёд и левую ногу назад до линии тела.",
      "Задержитесь на 2 секунды, не перекашивая таз.",
      "Вернитесь и повторите с другой стороны.",
    ],
    mistakes: ["Таз разворачивается или поясница прогибается.", "Слишком высокий подъём ноги."],
  },
  pullup: {
    name: "Подтягивания", muscles: "Широчайшие, бицепсы", reps: [3, 8], rest: 75, avoid: ["shoulders"],
    variants: [{ k: "bw", need: ["bar"], label: "На турнике", cue: "Хват чуть шире плеч. Если не получается, делайте медленный спуск вниз." }],
    props: [{ t: "bar", x: -36, w: 74, h: 118 }], anchor: "hand", track: ["sho"],
    frames: [
      { t: 180, la: [-14, 36, "f"], a: [180, 180], hy: -116 },
      { t: 178, la: [-20, 40, "f"], aw: [3, -9, "d"], hy: -116 },
    ],
    steps: [
      "Хват чуть шире плеч, повисните на прямых руках.",
      "Сведите лопатки и подтяните грудь к перекладине, локти идут вниз.",
      "Подбородок выше перекладины. Спуск медленный, 3 секунды.",
      "Если подтянуться не получается, встаньте на опору и делайте только медленный спуск (3–5 секунд).",
    ],
    mistakes: ["Рывки ногами.", "Неполный спуск вниз.", "Шея вытягивается вперёд."],
  },

  /* ---------- Грудь, плечи, кор ---------- */
  pushup: {
    name: "Отжимания", muscles: "Грудные, трицепсы, передние пучки плеч", reps: [8, 15], rest: 45, floor: true, avoid: ["wrists", "shoulders"],
    variants: [
      { k: "knees", need: [], lvl: ["n"], label: "От колен", cue: "Опора на колени, линия «колени — плечи» прямая." },
      { k: "bw", need: [], label: "Классические", cue: "Тело — прямая линия от головы до пяток." },
    ],
    anchor: "hand", track: ["sho"],
    frames: [
      { t: 111, lin: true, a: [0, 0], f: 20, fit: ["hand", "toe"] },
      { t: 100, lin: true, aw: [-4, 10, "u"], f: 20, fit: ["hand", "toe"] },
    ],
    frameV: {
      knees: [
        { t: 118, lin: true, sb: -75, a: [0, 0], f: -90, fit: ["hand", "knee"] },
        { t: 105, lin: true, sb: -75, aw: [-4, 10, "u"], f: -90, fit: ["hand", "knee"] },
      ],
    },
    steps: [
      "Упор лёжа: ладони чуть шире плеч, тело прямая линия (в упрощённом варианте от колен до головы).",
      "Согните локти и опустите грудь к полу, локти под углом около 45° к корпусу.",
      "Оттолкнитесь и выпрямите руки. Живот и ягодицы напряжены.",
      "Смотрите в пол перед собой, шея нейтральна.",
    ],
    mistakes: ["Провисающая поясница или поднятый таз.", "Локти разведены в стороны под 90°.", "Неполная амплитуда: опускайтесь, пока грудь не окажется в кулаке от пола."],
  },
  chestpress: {
    name: "Жим от груди", muscles: "Грудные и трицепсы", reps: [12, 15], rest: 40, avoid: ["shoulders"],
    variants: [
      { k: "band", need: ["tube", "anchor"], label: "С эспандером в двери", cue: "Якорь за спиной на уровне груди. Дверь плотно закрыта." },
      { k: "cable", need: ["cable"], label: "На блочном тренажёре", cue: "Блок на уровне груди, стойка «одна нога вперёд»." },
    ],
    band: { t: "door", x: "L", h: 0.76, col: BAND_COL.tube }, track: ["hand"],
    frames: [
      { t: 178, la: [8, 54, "f"], LA: [-12, 54, "f"], F: 90, aw: [10, 6, "b"] },
      { t: 178, la: [8, 54, "f"], LA: [-12, 54, "f"], F: 90, a: [90, 90] },
    ],
    steps: [
      "Закрепите эспандер за спиной на уровне груди, встаньте лицом от двери, одна нога впереди.",
      "Ручки у груди, локти согнуты.",
      "Выжимайте руки вперёд до выпрямления, плечи опущены.",
      "Медленно вернитесь.",
    ],
    mistakes: ["Корпус наклоняется вперёд или раскачивается.", "Локти слишком высоко: держите их под углом около 45°."],
  },
  floorpress: {
    name: "Жим гантелей лёжа на полу", muscles: "Грудные и трицепсы", reps: [10, 14], rest: 45, floor: true, mat: true, avoid: ["shoulders"],
    variants: [{ k: "db", need: ["dumbbell"], label: "С гантелями", cue: "Локти касаются пола плавно, без удара." }],
    anchor: "hip", track: ["hand"],
    frames: [
      { t: -90, ...FLOOR_LEG, hd: -100, a: [100, 180] },
      { t: -90, ...FLOOR_LEG, hd: -100, a: [180, 180] },
    ],
    steps: [
      "Лягте на спину, колени согнуты, гантели в руках над грудью.",
      "Опустите локти до касания пола, угол около 45° к корпусу.",
      "Выжмите гантели вверх до выпрямления рук.",
    ],
    mistakes: ["Удары локтями об пол: опускайтесь плавно.", "Прогиб в пояснице: стопы на полу, поясница прижата."],
  },
  shoulderpress: {
    name: "Жим над головой", muscles: "Плечи и трицепсы", reps: [10, 14], rest: 40, avoid: ["shoulders"],
    variants: [
      { k: "db", need: ["dumbbell"], label: "С гантелями", cue: "Гантели у плеч, ладони вперёд." },
      { k: "band", need: ["loop|tube"], label: "С резинкой под ногами", cue: "Встаньте на середину резинки, ручки у плеч." },
    ],
    band: { t: "foot", col: BAND_COL.tube }, track: ["hand"],
    frames: [{ ...STAND, a: [25, 180] }, { ...STAND, a: [180, 180] }],
    steps: [
      "Встаньте на резинку (или возьмите гантели), ручки на уровне плеч.",
      "Корпус ровный, пресс и ягодицы напряжены.",
      "Выжмите руки вверх над головой до выпрямления.",
      "Медленно опустите к плечам.",
    ],
    mistakes: ["Прогиб в пояснице: напрягите пресс и ягодицы.", "Подталкивание ногами.", "Локти уходят далеко вперёд."],
  },
  plank: {
    name: "Планка на предплечьях", muscles: "Кор: пресс, поясница, ягодицы", secs: [20, 45], rest: 35, floor: true, mat: true,
    variants: [{ k: "bw", need: [], label: "На предплечьях", cue: "Дышите ровно, не задерживайте дыхание." }],
    anchor: "wrist", labels: ["Правильно", "Ошибка: таз провис"], badSecond: true,
    frames: [
      { t: 96, lin: true, a: [0, 90], f: 30, fit: ["hand", "toe"] },
      { t: 99, la: [-52, 14, "d"], a: [0, 90], f: 30, hd: 96 },
    ],
    steps: [
      "Упор на предплечья: локти под плечами, тело прямая линия от макушки до пяток.",
      "Напрягите пресс и ягодицы, чуть подтяните живот к позвоночнику.",
      "Смотрите в пол, дышите ровно.",
      "Держите заданное время. Если форма ломается, остановитесь и отдохните.",
    ],
    mistakes: ["Провисшая поясница: подтяните таз к линии тела.", "Таз задран вверх.", "Задержка дыхания."],
  },
  deadbug: {
    name: "Мёртвый жук", muscles: "Глубокий пресс", reps: [8, 12], side: true, rest: 30, floor: true, mat: true,
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Поясница прижата к полу всё время." }],
    anchor: "hip", track: ["hand", "ankleF"],
    frames: [
      { t: -90, la: [27, -28, "u"], f: 90, a: [180, 180], hd: -100, LA: [27, -28, "u"], F: 90, A: [180, 180] },
      { t: -90, la: [27, -28, "u"], f: 90, a: [-95, -95], hd: -100, LA: [54, -6, "u"], F: 90, A: [180, 180] },
    ],
    steps: [
      "Лягте на спину, руки подняты к потолку, колени согнуты на 90° над тазом.",
      "Прижмите поясницу к полу.",
      "Одновременно выпрямите противоположные руку и ногу, не отрывая поясницу.",
      "Вернитесь и смените сторону.",
    ],
    mistakes: ["Поясница отрывается от пола: уменьшите амплитуду.", "Слишком быстрый темп."],
  },
  crunch: {
    name: "Скручивания", muscles: "Прямая мышца живота", reps: [12, 20], rest: 30, floor: true, mat: true,
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Подбородок не прижимайте к груди." }],
    anchor: "ankle", track: ["head"],
    frames: [
      { t: -90, ...FLOOR_LEG, hd: -100, aw: [10, 8, "u"] },
      { t: -126, ...FLOOR_LEG, hd: -140, aw: [10, 8, "u"] },
    ],
    steps: [
      "Лягте на спину, колени согнуты, стопы на полу, руки скрещены на груди или у висков.",
      "Выдохните и оторвите лопатки от пола, скручивая корпус. Поясница остаётся прижатой.",
      "Задержитесь на секунду и медленно вернитесь, не расслабляясь полностью.",
    ],
    mistakes: ["Тяга за голову руками.", "Подъём всего корпуса вместо скручивания."],
  },
  legraise: {
    name: "Подъёмы ног лёжа", muscles: "Нижний пресс", reps: [8, 12], rest: 35, floor: true, mat: true, avoid: ["back"],
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Если поясница отрывается, согните колени." }],
    anchor: "hip", track: ["ankle"],
    frames: [
      { t: -90, la: [54, -8, "u"], f: 90, hd: -100, a: [90, 90] },
      { t: -90, la: [2, -54.7, "f"], f: 90, hd: -100, a: [90, 90] },
    ],
    steps: [
      "Лягте на спину, руки вдоль тела, ноги прямые вместе.",
      "Прижмите поясницу к полу.",
      "Поднимите ноги до вертикали и медленно опустите, не касаясь пола.",
    ],
    mistakes: ["Прогиб в пояснице: согните колени или подложите ладони под таз.", "Рывок вместо плавного движения."],
  },
  mtnclimber: {
    name: "Скалолаз", muscles: "Кор, плечи и ноги", secs: [20, 40], rest: 40, floor: true, avoid: ["wrists", "back"],
    variants: [{ k: "bw", need: [], label: "Без веса", cue: "Темп такой, чтобы сохранять форму." }],
    anchor: "hand", track: ["kneeF"],
    frames: [
      { t: 108, la: [20, 24, "f"], a: [0, 0], f: 60, Llin: true, F: 20, fit: ["hand", "toeF"] },
      { t: 108, lin: true, a: [0, 0], f: 20, LA: [20, 24, "f"], F: 60, fit: ["hand", "toe"] },
    ],
    steps: [
      "Упор лёжа на прямых руках, тело прямая линия.",
      "Поочерёдно подтягивайте колени к груди в контролируемом темпе.",
      "Таз не поднимается, плечи над ладонями.",
    ],
    mistakes: ["Таз высоко: держите линию.", "Слишком быстрый темп с потерей формы: сбавьте."],
  },
  dips: {
    name: "Отжимания от скамьи", muscles: "Трицепсы и грудные", reps: [8, 12], rest: 45, avoid: ["shoulders", "wrists"],
    variants: [{ k: "bw", need: ["bench"], label: "Без веса", cue: "Скамья или стул должны надёжно стоять." }],
    props: [{ t: "box", x: -96, w: 44, h: 30 }], anchor: "ankle", track: ["hip"],
    frames: [
      { t: 186, la: [44, 33, "f"], aw: [-10, 37, "b"], f: 100 },
      { t: 180, la: [51, 19, "f"], aw: [-6.6, 22, "b"], f: 100 },
    ],
    steps: [
      "Сядьте на край скамьи, ладони рядом с бёдрами, сойдите вперёд так, чтобы таз был перед скамьёй.",
      "Согните локти назад до угла около 90°, спина близко к скамье.",
      "Выпрямите руки, не отводя плечи вперёд.",
    ],
    mistakes: ["Плечи уходят вперёд и вниз: не опускайтесь ниже 90° в локтях.", "Локти разведены в стороны."],
  },

  /* ---------- Кардио ---------- */
  walk_tm: {
    name: "Ходьба на дорожке", muscles: "Всё тело, разогрев сердца", cardio: true, kind: "cardio",
    variants: [{ k: "bw", need: ["treadmill"], label: "Беговая дорожка", cue: "Спокойный темп 3–4 км/ч, для интервалов 5–6 км/ч." }],
    props: [{ t: "belt", x: -62, w: 124 }], anchor: "hip",
    frames: [
      { t: 180, la: [14, 52, "f"], LA: [-14, 52, "f"], F: 50, a: [-30, -10], A: [35, 60] },
      { t: 180, la: [-14, 52, "f"], LA: [14, 52, "f"], F: 90, f: 50, a: [35, 60], A: [-30, -10] },
    ],
    steps: ["Встаньте на дорожку, включите спокойный темп.", "Выпрямитесь, смотрите вперёд, руки свободно двигаются в такт шагам.", "Дышите ровно: вы должны свободно разговаривать."],
    mistakes: ["Держаться за поручни всё время: корпус заваливается.", "Слишком большая скорость с первых секунд."],
  },
  walk_out: {
    name: "Быстрая ходьба или трусца", muscles: "Всё тело, разогрев сердца", cardio: true, kind: "cardio",
    variants: [{ k: "bw", need: [], label: "На улице", cue: "Спокойный темп, при желании переходите на трусцу." }],
    anchor: "hip",
    frames: [
      { t: 180, la: [14, 52, "f"], LA: [-14, 52, "f"], F: 50, a: [-30, -10], A: [35, 60] },
      { t: 180, la: [-14, 52, "f"], LA: [14, 52, "f"], F: 90, f: 50, a: [35, 60], A: [-30, -10] },
    ],
    steps: ["Начните спокойным шагом, постепенно прибавляя темп.", "Выпрямитесь, смотрите вперёд, руки свободно двигаются.", "Дышите ровно: вы должны свободно разговаривать."],
    mistakes: ["Слишком большая скорость с первых минут.", "Сутулость и взгляд в землю."],
  },
  march: {
    name: "Марш на месте", muscles: "Всё тело, разогрев", cardio: true, kind: "cardio",
    variants: [{ k: "bw", need: [], label: "Без инвентаря", cue: "Поднимайте колени до уровня таза, руки работают в такт." }],
    anchor: "hip",
    frames: [
      { t: 180, la: [26, 30, "f"], LA: [0, 55, "f"], a: [-35, -20], A: [40, 70] },
      { t: 180, la: [0, 55, "f"], LA: [26, 30, "f"], a: [40, 70], A: [-35, -20] },
    ],
    steps: ["Встаньте прямо и шагайте на месте, высоко поднимая колени.", "Руки сгибайте и двигайте в такт шагам.", "Ускоряйтесь постепенно."],
    mistakes: ["Сутулость и взгляд в пол.", "Слишком резкие удары стопой."],
  },

  /* ---------- Растяжка ---------- */
  st_child: {
    name: "Поза ребёнка", muscles: "Спина, ягодицы, плечи", kind: "stretch", floor: true, mat: true,
    variants: [{ k: "bw", need: [], label: "Растяжка", cue: "Дышите глубоко, с каждым выдохом расслабляйтесь глубже." }],
    anchor: "ankle",
    frames: [
      { t: 180, la: [0, 17, "f"], f: -90, aw: [18, 18, "d"] },
      { t: 88, la: [0, 17, "f"], f: -90, a: [92, 92], hd: 60 },
    ],
    steps: ["Сядьте на пятки на коврике.", "Наклонитесь вперёд, вытяните руки перед собой, лоб опустите к полу.", "Расслабьте плечи и шею, дышите глубоко."],
    mistakes: ["Тянуть через боль: растяжение должно быть мягким."],
  },
  st_ham: {
    name: "Растяжка задней поверхности бедра", muscles: "Задняя поверхность бедра", kind: "stretch", side: true, floor: true, mat: true,
    variants: [
      { k: "band", need: ["loop|tube"], label: "С резинкой", cue: "Зацепите резинку за стопу и держите концы руками." },
      { k: "bw", need: [], label: "Руками за бедро", cue: "Держите ногу руками под коленом." },
    ],
    band: { t: "ankle", col: BAND_COL.loop, noHandle: true }, anchor: "hip",
    frames: [
      { t: -90, la: [38, -38, "u"], f: 90, hd: -100, aw: [24, -26, "u"], LA: [54, 2, "u"], F: 150 },
      { t: -90, la: [12, -54, "u"], f: 90, hd: -100, aw: [18, -22, "u"], LA: [54, 2, "u"], F: 150 },
    ],
    steps: ["Лягте на спину, одну ногу вытяните по полу.", "Вторую поднимите вверх, держась руками (или резинкой, зацепленной за стопу).", "Мягко подтягивайте ногу к себе, колено почти прямое. Дышите ровно, затем смените ногу."],
    mistakes: ["Резкие рывки: тяните плавно.", "Поясница отрывается от пола."],
  },
  st_calf: {
    name: "Растяжка икр у стены", muscles: "Икроножные мышцы", kind: "stretch", side: true,
    variants: [{ k: "bw", need: [], label: "У стены", cue: "Пятка задней ноги прижата к полу." }],
    props: [{ t: "wall", x: 6 }], anchor: "hand",
    frames: [
      { t: 168, la: [22, 52, "f"], LA: [-14, 54, "f"], F: 90, a: [90, 90], fit: ["hand", "ankle"] },
      { t: 158, la: [30, 46, "f"], LA: [-24, 52, "f"], F: 90, a: [90, 90], fit: ["hand", "ankle"] },
    ],
    steps: ["Встаньте лицом к стене, ладони на стене на уровне плеч.", "Отставьте одну ногу назад, пятка прижата к полу, нога прямая; переднюю ногу согните.", "Наклоняйтесь к стене, пока не почувствуете мягкое растяжение в икре, затем смените ногу."],
    mistakes: ["Пятка отрывается от пола.", "Носок задней ноги развёрнут в сторону."],
  },
  st_quad: {
    name: "Растяжка передней поверхности бедра", muscles: "Квадрицепсы", kind: "stretch", side: true,
    variants: [{ k: "bw", need: [], label: "Стоя", cue: "При необходимости придерживайтесь за стену." }],
    anchor: "ankleF",
    frames: [
      { t: 180, la: [-8, 34, "f"], LA: [0, 55, "f"], F: 90, aw: [-6, 24, "b"] },
      { t: 180, la: [-14, 5, "f"], LA: [0, 55, "f"], F: 90, aw: [-14, 39, "b"] },
    ],
    steps: ["Встаньте на одну ногу, при необходимости придерживайтесь за стену.", "Согните вторую ногу и возьмите стопу рукой, подтяните пятку к ягодице.", "Колени рядом, таз слегка подкручен. Дышите ровно, затем смените ногу."],
    mistakes: ["Колено уходит далеко вперёд или в сторону.", "Корпус наклоняется вперёд."],
  },
};


for (const [id, ex] of Object.entries(EXERCISES)) ex.id = id;

const svgCache = new Map();
// Иллюстрация упражнения для выбранного варианта
export function illustration(id, vk) {
  const key = `${id}:${vk}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const ex = EXERCISES[id];
  if (!ex) return "";
  const frames = ex.frameV && ex.frameV[vk] ? ex.frameV[vk] : ex.frames;
  const svg = exerciseSvg({ ...ex, frames }, vk);
  svgCache.set(key, svg);
  return svg;
}

/* ================= Даты ================= */
const pd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const fd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dowOf = (s) => (pd(s).getDay() + 6) % 7; // 0 = понедельник
export const mondayOf = (s) => { const d = pd(s); d.setDate(d.getDate() - dowOf(s)); return fd(d); };
export const addDaysS = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };
const weekNo = (s) => Math.round((pd(mondayOf(s)).getTime() - pd("2024-01-01").getTime()) / 604800000);

/* ================= Настройки ================= */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Разовые переносы: «дата по плану» → «дата, когда занимаюсь на этой неделе»
function cleanMoves(m) {
  const out = {};
  if (m && typeof m === "object") for (const [a, b] of Object.entries(m)) if (DATE_RE.test(a) && DATE_RE.test(String(b)) && a !== b) out[a] = String(b);
  return out;
}
function cleanBands(b) {
  const o = {};
  if (b && typeof b === "object") for (const c of BAND_COLORS) { const n = Number(b[c.id]); if (n > 0) o[c.id] = n; }
  return o;
}
export const mgOf = (id) => MG_OF[id] || "";
export function normCfg(raw, today) {
  const r = raw || {};
  const place = PLACES.some((p) => p.v === r.place) ? r.place : "home";
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
  const eq = {};
  for (const p of PLACES) eq[p.v] = Array.isArray(r.equip && r.equip[p.v]) ? r.equip[p.v].filter((x) => EQUIP.some((e) => e.id === x)) : DEFAULT_EQUIP[p.v].slice();
  const min = Number(r.minutes);
  return {
    place,
    days: days.length ? days : DEFAULT_DAYS.slice(),
    equip: eq,
    minutes: min >= 10 && min <= 90 ? Math.round(min) : 30,
    level: TRAIN_LEVELS.some((l) => l.v === r.level) ? r.level : "m",
    limits: Array.isArray(r.limits) ? r.limits.filter((x) => LIMITS.some((l) => l.id === x)) : [],
    dumbbellKg: Number(r.dumbbellKg) > 0 ? Number(r.dumbbellKg) : 0,
    bandKg: cleanBands(r.bandKg),
    startedAt: /^\d{4}-\d{2}-\d{2}$/.test(r.startedAt || "") ? r.startedAt : today,
    moves: cleanMoves(r.moves),
  };
}

/* ================= Сборка плана ================= */
const TYPES = ["A", "B", "C"];
const BLUEPRINT = {
  A: {
    short: "Ноги и ягодицы", focus: "Акцент на ноги и ягодицы, плюс верх тела и кор",
    slots: [["squat", "bridge"], ["pushup", "chestpress", "floorpress", "dips"], ["rdl", "bridge"], ["row", "bentrow", "pulldown", "pullup"], ["bridge", "donkey", "stepup"], ["lunge", "stepup", "donkey", "calf"], ["plank", "deadbug"], ["donkey", "calf"], ["shoulderpress", "facepull"], ["calf", "crunch"], ["deadbug", "crunch"], ["curl", "triext"]],
    cool: ["st_quad", "st_calf", "st_ham", "st_child"],
  },
  B: {
    short: "Спина и руки", focus: "Акцент на спину и руки, плюс ноги и кор",
    slots: [["pulldown", "pullup", "row", "bentrow"], ["squat", "bridge", "rdl"], ["row", "bentrow"], ["pushup", "chestpress", "floorpress", "dips"], ["facepull", "superman"], ["bridge", "rdl", "lunge"], ["curl"], ["pushdown", "triext"], ["birddog", "deadbug"], ["superman", "plank"], ["lunge", "stepup", "calf"], ["triext", "crunch"]],
    cool: ["st_ham", "st_child", "st_calf", "st_quad"],
  },
  C: {
    short: "Грудь, плечи и кор", focus: "Акцент на грудь, плечи и пресс, плюс ноги и спина",
    slots: [["pushup", "chestpress", "floorpress", "dips"], ["squat", "bridge"], ["shoulderpress", "facepull"], ["rdl", "bridge"], ["chestpress", "floorpress", "dips", "pushdown"], ["row", "bentrow", "pulldown", "pullup"], ["plank", "birddog"], ["lunge", "stepup", "donkey"], ["dips", "triext", "pushdown"], ["crunch", "legraise"], ["mtnclimber", "deadbug"], ["calf", "facepull"]],
    cool: ["st_child", "st_ham", "st_quad", "st_calf"],
  },
};

const haveOf = (cfg) => new Set(cfg.equip[cfg.place] || DEFAULT_EQUIP[cfg.place]);
const needOk = (need, have) => (need || []).every((n) => n.split("|").some((x) => have.has(x)));

function pickVariant(ex, ctx) {
  for (const v of ex.variants) {
    if (!needOk(v.need, ctx.have)) continue;
    if (v.lvl && !v.lvl.includes(ctx.level)) continue;
    return v;
  }
  return null;
}
function usable(ex, ctx) {
  if (!ex) return false;
  if (!pickVariant(ex, ctx)) return false;
  if (ex.floor && ctx.place === "outdoor" && !ctx.have.has("mat")) return false;
  if (ex.avoid && ex.avoid.some((l) => ctx.limits.has(l))) return false;
  return true;
}

function baseType(cfg, date) {
  const i = cfg.days.indexOf(dowOf(date));
  if (i < 0) return null;
  const c = weekNo(date) * cfg.days.length + i;
  return TYPES[((c % 3) + 3) % 3];
}
// Тип тренировки в этот день с учётом разовых переносов
export function sessionType(cfg, date) {
  const mv = cfg.moves || {};
  for (const [from, to] of Object.entries(mv)) if (to === date) return baseType(cfg, from);
  if (mv[date]) return null;
  return baseType(cfg, date);
}
// Если в этот день стоит перенесённая тренировка, вернёт исходную дату
export function movedFrom(cfg, date) {
  for (const [from, to] of Object.entries(cfg.moves || {})) if (to === date) return from;
  return null;
}
export const typeShort = (t) => (BLUEPRINT[t] ? BLUEPRINT[t].short : "");


// Группа мышц для разделения плана: основная нагрузка упражнения
export const MG = { legs: "Ноги", glutes: "Ягодицы", back: "Спина", chest: "Грудь", shoulders: "Плечи", biceps: "Бицепс", triceps: "Трицепс", core: "Кор" };
const MG_OF = {
  squat: "legs", lunge: "legs", stepup: "legs", calf: "legs",
  rdl: "glutes", bridge: "glutes", donkey: "glutes",
  row: "back", bentrow: "back", pulldown: "back", pullup: "back", superman: "back", facepull: "shoulders",
  curl: "biceps", triext: "triceps", pushdown: "triceps", dips: "triceps",
  pushup: "chest", chestpress: "chest", floorpress: "chest", shoulderpress: "shoulders",
  plank: "core", deadbug: "core", crunch: "core", legraise: "core", mtnclimber: "core", birddog: "core",
};

function itemFor(ex, ctx, group, sets, cardioMin) {
  const v = pickVariant(ex, ctx);
  const prog = Math.min(3, ctx.weeks);
  const adj = ({ n: -2, m: 0, a: 2 }[ctx.level] || 0) + (ctx.bump || 0);
  const it = { key: `${group}:${ex.id}`, id: ex.id, name: ex.name, group, vk: v.k, vlabel: v.label, cue: v.cue, side: !!ex.side, muscles: ex.muscles, mg: MG_OF[ex.id] || "" };
  const rest = Math.max(20, (ex.rest || 40) + (ctx.goal === "gain" ? 20 : ctx.goal === "lose" ? -5 : 0));
  if (ex.kind === "cardio") {
    it.minutes = cardioMin;
    it.est = cardioMin * 60;
    it.text = `${cardioMin} мин`;
    it.sub = group === "warm" ? "лёгкий темп" : ex.id === "walk_tm" ? "1 мин быстрее, 1 мин спокойнее" : ex.id === "march" ? "высоко поднимайте колени" : "быстрым шагом или трусцой";
    return it;
  }
  if (ex.kind === "stretch") {
    it.sets = 1;
    it.secs = [30, 40];
    it.est = (ex.side ? 2 : 1) * 38 + 8;
    it.text = ex.side ? "30–40 сек на сторону" : "30–40 сек";
    it.sub = "без боли, дыхание ровное";
    return it;
  }
  it.sets = sets;
  it.rest = rest;
  if (ex.reps) {
    const lo = Math.max(ex.reps[0] <= 5 ? 2 : 5, ex.reps[0] + adj + prog), hi = Math.max(lo, ex.reps[1] + adj + prog);
    it.reps = [lo, hi];
    const avg = (lo + hi) / 2, work = avg * 3.2 * (ex.side ? 2 : 1);
    it.est = Math.round(sets * (work + 12 + (ex.side ? 6 : 0)) + (sets - 1) * rest + 20);
    it.text = `${sets} × ${lo === hi ? lo : `${lo}–${hi}`}${ex.side ? " на сторону" : ""}`;
  } else {
    const k = { n: -5, m: 0, a: 10 }[ctx.level] || 0;
    const lo = Math.max(10, ex.secs[0] + k + prog * 5), hi = Math.max(lo, ex.secs[1] + k + prog * 5);
    it.secs = [lo, hi];
    const avg = (lo + hi) / 2;
    it.est = Math.round(sets * (avg * (ex.side ? 2 : 1) + 8) + (sets - 1) * rest + 20);
    it.text = `${sets} × ${lo}–${hi} сек${ex.side ? " на сторону" : ""}`;
  }
  it.sub = `отдых ${rest} сек`;
  return it;
}

// minutesOverride: время на сегодня (15–60); профиль даёт цель (goal)
// avoid: упражнения, которые пользователь стабильно пропускает; в слоте их заменяет другое подходящее
export function buildSession(cfgRaw, date, profile, minutesOverride, bump, avoidIds) {
  const cfg = normCfg(cfgRaw, date);
  const type = sessionType(cfg, date);
  if (!type) return null;
  const M = Math.max(10, Math.min(90, Number(minutesOverride) > 0 ? Number(minutesOverride) : cfg.minutes));
  const ctx = {
    have: haveOf(cfg), place: cfg.place, level: cfg.level, limits: new Set(cfg.limits), goal: (profile && profile.goal) || "maintain",
    bump: Math.max(-2, Math.min(2, Number(bump) || 0)),
    weeks: Math.max(0, Math.round((pd(mondayOf(date)).getTime() - pd(mondayOf(cfg.startedAt)).getTime()) / 604800000)),
  };
  const bp = BLUEPRINT[type];
  const sets = M < 30 ? 2 : cfg.level === "n" && M < 45 ? 2 : 3;
  const cardioPick = (ids) => ids.map((i) => EXERCISES[i]).find((e) => e && pickVariant(e, ctx));
  const cardioEx = cardioPick(cfg.place === "outdoor" ? ["walk_out", "march"] : ["walk_tm", "walk_out", "march"]);
  const warmMin = M <= 20 ? 2 : M <= 30 ? 3 : M <= 45 ? 4 : 5;
  const warm = cardioEx ? [itemFor(cardioEx, ctx, "warm", 1, warmMin)] : [];
  const nStretch = M <= 20 ? 2 : 3;
  const cool = bp.cool.map((i) => EXERCISES[i]).filter((e) => usable(e, ctx)).slice(0, nStretch).map((e) => itemFor(e, ctx, "cool", 1, 0));
  let cardioMin = M >= 30 ? Math.round(M * (ctx.goal === "lose" ? 0.15 : ctx.goal === "gain" ? 0.1 : 0.13)) : 0;
  const sec = (arr) => arr.reduce((t, x) => t + x.est, 0);
  let budget = M * 60 - sec(warm) - sec(cool) - cardioMin * 60;
  const main = [];
  const used = new Set();
  let spent = 0;
  const avoid = new Set(Array.isArray(avoidIds) ? avoidIds : []);
  const swapped = [];
  for (const slot of bp.slots) {
    const okId = (id) => !used.has(id) && usable(EXERCISES[id], ctx);
    const base = slot.find(okId);
    let exId = slot.find((id) => okId(id) && !avoid.has(id)) || base;
    if (!exId) continue;
    if (base && base !== exId) swapped.push({ from: base, to: exId });
    const it = itemFor(EXERCISES[exId], ctx, "main", sets, 0);
    if (spent + it.est > budget + 30 && main.length >= 3) { if (base !== exId) swapped.pop(); continue; }
    main.push(it); used.add(exId); spent += it.est;
  }
  const left = budget - spent;
  if (left >= 150 && cardioEx) cardioMin = Math.min(15, cardioMin + Math.floor(left / 60));
  const fin = cardioEx && cardioMin > 0 ? [itemFor(cardioEx, ctx, "cardio", 1, cardioMin)] : [];
  const items = [...warm, ...main, ...fin, ...cool];
  return {
    date, type, minutes: M, title: bp.short, focus: bp.focus, items, bump: ctx.bump, swapped,
    est: Math.round(sec(items) / 60),
    sets, level: ctx.level, place: cfg.place,
  };
}

// Неделя: что стоит в какие дни (без подробностей упражнений)
export function weekPlan(cfgRaw, anyDate) {
  const mon = mondayOf(anyDate);
  const cfg = normCfg(cfgRaw, anyDate);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysS(mon, i);
    const type = sessionType(cfg, date);
    return { date, dow: i, type, title: type ? typeShort(type) : "" };
  });
}
