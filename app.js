// Калории — личный дневник питания. Firebase (вход + база) + GitHub Pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, where, serverTimestamp, writeBatch, increment,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { STARTER } from "./starter.js?v=6";

const firebaseConfig = {
  apiKey: "AIzaSyAItOJn5dO44kAy9xjrigslIdsE0au_y0A",
  authDomain: "calorie-app-45bd1.firebaseapp.com",
  projectId: "calorie-app-45bd1",
  storageBucket: "calorie-app-45bd1.firebasestorage.app",
  messagingSenderId: "894507748547",
  appId: "1:894507748547:web:eae9e6979bbc539596e676",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Локальный кэш: быстрее открывается и экономит бесплатные чтения общей базы
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  console.warn("Кэш Firestore недоступен, работаем без него:", e);
  db = getFirestore(app);
}

/* ================= Утилиты ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const todayStr = () => dstr(new Date());
const weekStart = (s) => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); };
const num = (v) => { const n = parseFloat(String(v).trim().replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : NaN; };
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => String(r1(n)).replace(".", ",");
const fmtInt = (n) => Math.round(n).toLocaleString("ru-RU");
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const firstName = (u) => {
  const raw = String((u && (u.displayName || u.email)) || "").trim();
  return (raw.split(/[\s@]/)[0] || "Пользователь").slice(0, 40);
};
const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const clampNum = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const WD_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WD_WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function dayLabel(s) {
  const t = todayStr();
  if (s === t) return "Сегодня";
  if (s === addDays(t, -1)) return "Вчера";
  if (s === addDays(t, 1)) return "Завтра";
  const d = parseD(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WD_SHORT[d.getDay()].toLowerCase()}`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ================= Состояние ================= */
const HISTORY_DAYS = 60; // сколько дней истории держим в приложении
const MEALS = [
  { id: "breakfast", name: "Завтрак", icon: "sunrise" },
  { id: "lunch", name: "Обед", icon: "sun" },
  { id: "dinner", name: "Ужин", icon: "moon" },
  { id: "snack", name: "Перекус", icon: "apple" },
];
const ICONS = {
  sunrise: '<path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 6v3M4.9 10.9l1.8 1.8M19.1 10.9l-1.8 1.8M2 18h20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  apple: '<path d="M12 8c-2-2-7-1-7 5 0 4 3 8 5 8 1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8 0-6-5-7-7-5z"/><path d="M12 8c0-2 1-3 3-4"/>',
};
const svgIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const CHEV_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SCAN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>';

const DROP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/></svg>';
const PULSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>';

/* ================= Здоровье: константы и расчёты ================= */
const SEX = [{ v: "male", t: "Мужской" }, { v: "female", t: "Женский" }];
const GOALS = [{ v: "lose", t: "Похудеть" }, { v: "gain", t: "Набрать мышцы" }, { v: "maintain", t: "Удержать вес" }];
const GOAL_NAME = { lose: "похудеть", gain: "набрать мышцы", maintain: "удержать вес" };
const LEVELS = [
  { v: "sedentary", t: "Сидячий образ жизни", k: 1.2 },
  { v: "light", t: "Лёгкая: 1–3 тренировки в неделю", k: 1.375 },
  { v: "moderate", t: "Умеренная: 3–5 тренировок в неделю", k: 1.55 },
  { v: "high", t: "Высокая: 6–7 тренировок или физический труд", k: 1.725 },
];
// MET: во сколько раз нагрузка расходует больше энергии, чем покой (справочные значения)
const ACTIVITIES = [
  { id: "walk", name: "Ходьба, обычный темп", met: 3.5 },
  { id: "walkfast", name: "Быстрая ходьба", met: 4.3 },
  { id: "run8", name: "Бег трусцой (около 8 км/ч)", met: 8.3 },
  { id: "run10", name: "Бег (около 10 км/ч)", met: 9.8 },
  { id: "bike", name: "Велосипед, умеренный темп", met: 6.8 },
  { id: "swim", name: "Плавание", met: 5.8 },
  { id: "strength", name: "Силовая тренировка", met: 5.0, strength: true },
  { id: "hiit", name: "Круговая тренировка, HIIT", met: 8.0 },
  { id: "yoga", name: "Йога", met: 2.5 },
  { id: "dance", name: "Танцы", met: 5.0 },
  { id: "team", name: "Командные игры", met: 7.0 },
];
const WEEKLY = {
  lose: { minutes: 200, strength: 2, text: "Ориентир: 200 минут умеренной нагрузки в неделю (быстрая ходьба, велосипед, плавание) и 2 силовые тренировки, чтобы сохранить мышцы при снижении веса." },
  gain: { minutes: 180, strength: 3, text: "Ориентир: 3 силовые тренировки в неделю с постепенным ростом нагрузки и 1–2 лёгких кардио по 20–30 минут, всего около 180 минут." },
  maintain: { minutes: 150, strength: 2, text: "Ориентир: 150 минут умеренной нагрузки в неделю и 2 силовые тренировки." },
};

// Основной обмен по формуле Миффлина: Сан-Жеора, затем коэффициент образа жизни и поправка на цель
function computePlan(p) {
  const age = Number(p.age), h = Number(p.heightCm), w = Number(p.weightKg);
  if (!(age >= 18 && age <= 80 && h >= 120 && h <= 230 && w >= 30 && w <= 250)) return null;
  if (!SEX.some((x) => x.v === p.sex) || !GOAL_NAME[p.goal]) return null;
  const level = LEVELS.find((l) => l.v === p.activity) || LEVELS[0];
  const bmr = 10 * w + 6.25 * h - 5 * age + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * level.k;
  const bmi = w / ((h / 100) ** 2);
  const warnings = [];
  let goal = p.goal;
  if (goal === "lose" && bmi < 18.5) {
    goal = "maintain";
    warnings.push("При вашем индексе массы тела снижение веса не рекомендуется, поэтому план рассчитан на поддержание веса.");
  }
  const floor = p.sex === "male" ? 1500 : 1200;
  let kcal = tdee;
  if (goal === "lose") {
    const deficit = Math.min(700, Math.max(300, tdee * 0.2));
    kcal = tdee - deficit;
    if (kcal < floor) { kcal = floor; warnings.push(`Калории не опускаются ниже безопасного минимума: ${fmtInt(floor)} ккал в день.`); }
  } else if (goal === "gain") {
    kcal = tdee + Math.min(400, Math.max(200, tdee * 0.1));
  }
  kcal = Math.round(kcal / 10) * 10;
  const perKg = goal === "lose" ? 2.0 : goal === "gain" ? 1.8 : 1.6;
  let protein = Math.round(perKg * w);
  const fat = Math.round(Math.max(0.8 * w, (0.25 * kcal) / 9));
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (carbs < 50) { protein = Math.round(1.6 * w); carbs = Math.round((kcal - protein * 4 - fat * 9) / 4); }
  carbs = Math.max(0, carbs);
  const water = Math.min(4500, Math.max(1500, Math.round((w * 33) / 50) * 50));
  const wk = WEEKLY[goal];
  const bmiLabel = bmi < 18.5 ? "ниже нормы" : bmi < 25 ? "в норме" : bmi < 30 ? "выше нормы" : "значительно выше нормы";
  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, water, bmi: r1(bmi), bmiLabel, goal, warnings,
    weekly: { ...wk, kcal: Math.round((5 * w * wk.minutes) / 60 / 10) * 10 },
  };
}

const state = {
  user: null,
  tab: "diary",
  date: todayStr(),
  products: [],
  entries: [],
  goal: 2000,
  repDays: 7,
  prodSearch: "",
  error: "",
  profile: {},
  water: [],
  activity: [],
  obShown: false,
  ready: { products: false, entries: false, settings: false, water: false, activity: false },
  unsubs: [],
};

const minDate = () => addDays(todayStr(), -HISTORY_DAYS);
const entriesOn = (d) => state.entries.filter((e) => e.date === d);
const sumEntries = (list) => list.reduce(
  (a, e) => ({ kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.protein || 0), fat: a.fat + (e.fat || 0), carbs: a.carbs + (e.carbs || 0) }),
  { kcal: 0, protein: 0, fat: 0, carbs: 0 },
);
const createdMs = (e) => (e.createdAt && typeof e.createdAt.toMillis === "function" ? e.createdAt.toMillis() : Date.now());

// Главная формула: значения в 100 г × введённые граммы / 100
function calc(per100, grams) {
  const k = grams / 100;
  return {
    kcal: Math.round(per100.kcal * k),
    protein: r1(per100.protein * k),
    fat: r1(per100.fat * k),
    carbs: r1(per100.carbs * k),
  };
}
const per100Of = (p) => ({ kcal: Number(p.kcal) || 0, protein: Number(p.protein) || 0, fat: Number(p.fat) || 0, carbs: Number(p.carbs) || 0 });
const per100Text = (p) => `${fmt(p.kcal)} ккал на 100 г: белки ${fmt(p.protein)}, жиры ${fmt(p.fat)}, углеводы ${fmt(p.carbs)}`;

function streak() {
  const have = new Set(state.entries.map((e) => e.date));
  let d = todayStr();
  if (!have.has(d)) d = addDays(d, -1);
  let n = 0;
  while (have.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ================= Вход / выход ================= */
const LOGIN_ERRORS = {
  "auth/unauthorized-domain": "Адрес этого сайта не добавлен в Firebase: Authentication → Settings → Authorized domains.",
  "auth/operation-not-allowed": "Вход через Google не включён: Authentication → Sign-in method → Google.",
  "auth/network-request-failed": "Нет соединения с интернетом.",
};
function showLoginError(err) {
  const code = err && err.code;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
  $("#login-error").textContent = LOGIN_ERRORS[code] || `Не удалось войти${code ? ` (${code})` : ""}. Попробуйте ещё раз.`;
}

$("#btn-login").addEventListener("click", async () => {
  $("#login-error").textContent = "";
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {
      try { await signInWithRedirect(auth, provider); } catch (e2) { showLoginError(e2); }
    } else {
      showLoginError(err);
    }
  }
});
getRedirectResult(auth).catch(showLoginError);

onAuthStateChanged(auth, (user) => {
  state.user = user || null;
  if (user) {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#loading").classList.remove("hidden");
    startData(user.uid);
  } else {
    stopData();
    $("#app").classList.add("hidden");
    $("#loading").classList.add("hidden");
    $("#login").classList.remove("hidden");
  }
});

/* ================= Данные (Firestore) ================= */
function stopData() {
  state.unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  state.unsubs = [];
  state.products = []; state.entries = []; state.error = "";
  state.ready = { products: false, entries: false, settings: false, water: false, activity: false };
  state.profile = {}; state.water = []; state.activity = []; state.obShown = false;
}

function markReady(name) {
  state.ready[name] = true;
  if (Object.values(state.ready).every(Boolean)) $("#loading").classList.add("hidden");
}

function startData(uid) {
  stopData();
  const fail = (err) => {
    console.error(err);
    const code = (err && err.code) || "";
    state.error = code === "permission-denied"
      ? "Нет доступа к базе. Опубликуйте правила из файла firestore.rules (Firestore → Rules → Publish)."
      : `Не удалось связаться с базой данных${code ? ` (${code})` : ""}. Проверьте, что Firestore создана и есть интернет.`;
    $("#loading").classList.add("hidden");
    render();
  };

  // Общая база: продукты видят и добавляют все пользователи
  state.unsubs.push(onSnapshot(collection(db, "products"), (snap) => {
    state.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    state.error = "";
    markReady("products"); render();
    migratePersonal(uid);
  }, fail));

  const from = minDate();
  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "entries"), where("date", ">=", from)), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    markReady("entries"); render();
  }, fail));

  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "profile"), (snap) => {
    state.profile = snap.exists() ? snap.data() : {};
    const g = Number(state.profile.goalKcal);
    state.goal = g > 0 ? g : 2000;
    markReady("settings"); render(); maybeOnboard();
  }, fail));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "water"), where("date", ">=", from)), (snap) => {
    state.water = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    markReady("water"); render();
  }, fail));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "activity"), where("date", ">=", from)), (snap) => {
    state.activity = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    markReady("activity"); render();
  }, fail));
}

const prodCol = () => collection(db, "products");
const prodDoc = (id) => doc(db, "products", id);
const productIdFor = (d) => {
  const bc = normBC(d.barcode);
  if (bc) return `bc_${bc}`;
  if (d.source === "starter") return `s_${fnv(fold(d.name))}`;
  return null;
};
const authorFields = () => ({ createdBy: state.user.uid, createdByName: firstName(state.user) });

// Один раз переносит личные продукты (старая версия) в общую базу
async function migratePersonal(uid) {
  if (state.migratedFor === uid) return;
  state.migratedFor = uid;
  try {
    const old = await getDocs(collection(db, "users", uid, "products"));
    if (old.empty) return;
    let added = 0;
    const known = state.products.slice();
    for (let i = 0; i < old.docs.length; i += 150) {
      const batch = writeBatch(db);
      for (const d of old.docs.slice(i, i + 150)) {
        const o = d.data();
        const name = String(o.name || "").trim().slice(0, 120);
        if (name) {
          const data = {
            name, brand: String(o.brand || "").slice(0, 80), barcode: String(o.barcode || "").replace(/\D/g, "").slice(0, 20),
            kcal: clampNum(o.kcal, 1000), protein: clampNum(o.protein, 100), fat: clampNum(o.fat, 100), carbs: clampNum(o.carbs, 100),
            source: String(o.source || "user"),
          };
          const dup = known.some((p) => fold(p.name) === fold(name) || (data.barcode && normBC(p.barcode) === normBC(data.barcode)));
          if (!dup) {
            const id = productIdFor(data);
            const ref = id ? prodDoc(id) : doc(prodCol());
            batch.set(ref, { ...data, ...authorFields(), createdAt: o.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
            known.push({ id: ref.id, ...data });
            added++;
          }
        }
        batch.delete(d.ref);
      }
      await batch.commit();
    }
    if (added) toast(`Ваши продукты перенесены в общую базу: ${added}`);
  } catch (e) {
    console.error("Перенос продуктов:", e);
    toast("Не удалось перенести прежние продукты в общую базу. Проверьте правила Firestore.");
  }
}
const colRef = (name) => collection(db, "users", state.user.uid, name);
const docRef = (name, id) => doc(db, "users", state.user.uid, name, id);
const writeFail = (err) => { console.error(err); toast("Не удалось сохранить. Проверьте соединение."); };

/* ================= Отрисовка: общее ================= */
function render() {
  if (!state.user) return;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const views = { diary: viewDiary, products: viewProducts, health: viewHealth, reports: viewReports, me: viewMe };
  const banner = state.error ? `<div class="banner" role="alert">${esc(state.error)}</div>` : "";
  $("#view").innerHTML = banner + views[state.tab]();
}

function donut(t) {
  const kP = t.protein * 4, kC = t.carbs * 4, kF = t.fat * 9;
  const sum = kP + kC + kF;
  const R = 44, C = 2 * Math.PI * R;
  let segs = "", off = 0;
  if (sum > 0) {
    for (const [k, col] of [[kP, "var(--protein)"], [kC, "var(--carbs)"], [kF, "var(--fat)"]]) {
      const len = (k / sum) * C;
      if (len > 0.5) segs += `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
      off += len;
    }
  }
  return `<svg viewBox="0 0 120 120" class="donut" role="img" aria-label="Калории и БЖУ">
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="14"/>${segs}
    <text x="60" y="59" text-anchor="middle" class="d-num">${fmtInt(t.kcal)}</text>
    <text x="60" y="73" text-anchor="middle" class="d-unit">ккал</text></svg>`;
}

/* ================= Дневник ================= */
function dateShort(s) { const d = parseD(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

function macrosHtml(p, f, c) {
  return `<span class="mx"><i style="background:var(--protein)"></i>Белки ${fmt(p)}</span><span class="mx"><i style="background:var(--fat)"></i>Жиры ${fmt(f)}</span><span class="mx"><i style="background:var(--carbs)"></i>Углеводы ${fmt(c)}</span>`;
}

function pageHead(overline, title, actions = "") {
  return `<header class="head"><div><div class="overline">${overline}</div><h1 class="title">${title}</h1></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</header>`;
}

function viewDiary() {
  const day = state.date;
  const list = entriesOn(day);
  const t = sumEntries(list);
  const min = minDate();

  // неделя
  const ws = weekStart(day);
  const have = new Set(state.entries.map((e) => e.date));
  const today = todayStr();
  let weekHtml = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const cls = ["wd", have.has(d) ? "done" : "", d === day ? "sel" : "", d === today ? "today" : ""].join(" ");
    weekHtml += `<button type="button" class="${cls}" data-act="pickDay" data-date="${d}" ${d < min ? "disabled" : ""}>
      <span class="wd-name">${WD_WEEK[i]}</span><span class="wd-dot">${have.has(d) ? CHECK : ""}</span></button>`;
  }
  const st = streak();
  const streakText = st > 0 ? `Серия записей: <b>${st} дн.</b>` : "Запишите еду сегодня, чтобы начать серию";

  // сводка
  const kP = t.protein * 4, kC = t.carbs * 4, kF = t.fat * 9, sum = kP + kC + kF;
  const pct = (k) => (sum > 0 ? Math.round((k / sum) * 100) : 0);
  const left = state.goal - t.kcal;
  const over = left < 0;
  const barPct = Math.min(100, (t.kcal / state.goal) * 100);
  const pf = state.profile;
  const legend = [
    ["Белки", "var(--protein)", t.protein, pct(kP), pf.goalProtein],
    ["Углеводы", "var(--carbs)", t.carbs, pct(kC), pf.goalCarbs],
    ["Жиры", "var(--fat)", t.fat, pct(kF), pf.goalFat],
  ].map(([n, c, g, p, tg]) => `<div class="lg-row"><span class="lg-dot" style="background:${c}"></span><span class="lg-name">${n}${tg ? `<small>цель ${fmtInt(tg)} г</small>` : ""}</span><span class="lg-val">${fmt(g)} г<small>${p}%</small></span></div>`).join("");

  // приёмы пищи
  const mealsHtml = MEALS.map((m) => {
    const items = list.filter((e) => e.meal === m.id).sort((a, b) => createdMs(a) - createdMs(b));
    const mt = sumEntries(items);
    const rows = items.map((e) => `
      <button type="button" class="entry" data-act="editEntry" data-id="${esc(e.id)}">
        <span class="e-main"><span class="e-name">${esc(e.name)}</span><span class="e-sub">${fmt(e.grams)} г${e.brand ? `, ${esc(e.brand)}` : ""}</span></span>
        <span class="e-kcal">${fmtInt(e.kcal)}<small>ккал</small></span>
      </button>`).join("");
    return `<section class="card meal">
      <div class="meal-head">
        <span class="meal-ic ${m.id}">${svgIcon(m.icon)}</span>
        <div class="meal-name">${m.name}</div>
        <div class="meal-kcal">${fmtInt(mt.kcal)}<small>ккал</small></div>
        <button type="button" class="add-btn" data-act="addFood" data-meal="${m.id}" aria-label="Добавить в «${m.name}»">+</button>
        <div class="meal-macros">${macrosHtml(mt.protein, mt.fat, mt.carbs)}</div>
      </div>
      ${rows ? `<div class="entries">${rows}</div>` : ""}
    </section>`;
  }).join("");

  return `
    ${pageHead("Дневник", dayLabel(day), `
      <button type="button" class="iconbtn" data-act="prevDay" aria-label="Предыдущий день" ${day <= min ? "disabled" : ""}>${CHEV_L}</button>
      <button type="button" class="chip-btn" data-act="today">${dateShort(day)}</button>
      <button type="button" class="iconbtn" data-act="nextDay" aria-label="Следующий день">${CHEV_R}</button>`)}
    <section class="card week"><div class="week-row">${weekHtml}</div><p class="streak">${streakText}</p></section>
    <section class="hero ${over ? "over" : ""}">
      <div class="hero-head"><span>${over ? "Перебор" : "Осталось"}</span><span class="hero-stamp">цель ${fmtInt(state.goal)} ккал</span></div>
      <div class="hero-value">${fmtInt(Math.abs(left))}<small>ккал</small></div>
      <div class="hero-caption">Съедено ${fmtInt(t.kcal)} ккал</div>
      <div class="hero-track"><i style="width:${barPct}%"></i></div>
    </section>
    ${miniTiles(day)}
    <section class="card">
      <h2 class="h2">Баланс БЖУ</h2>
      <div class="sum-grid">${donut(t)}<div class="legend">${legend}</div></div>
    </section>
    ${mealsHtml}`;
}

/* ================= Продукты ================= */
const fold = (t) => String(t || "").toLowerCase().replace(/ё/g, "е");
function filterProducts(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return state.products;
  return state.products.filter((p) => {
    const hay = fold(`${p.name} ${p.brand || ""} ${p.barcode || ""} ${p.createdByName || ""}`);
    return words.every((w) => hay.includes(w)); // все слова запроса должны встретиться: «куриная жарен»
  });
}

function productRow(p, attr) {
  const mine = !!state.user && p.createdBy === state.user.uid;
  const by = !mine && p.createdByName ? `Добавил(а): ${esc(p.createdByName)}` : "";
  const meta = [p.brand ? esc(p.brand) : "", p.barcode ? esc(p.barcode) : "", by].filter(Boolean).join(", ");
  return `<button type="button" class="prow" ${attr}="${esc(p.id)}">
    <span class="p-main"><span class="p-name">${esc(p.name)}</span><span class="p-macros">${macrosHtml(p.protein, p.fat, p.carbs)}</span>${meta ? `<span class="p-sub">${meta}</span>` : ""}</span>
    <span class="p-kcal">${fmtInt(p.kcal)}<small>ккал / 100 г</small></span></button>`;
}

const emptyProducts = `<div class="empty"><b>Продуктов пока нет</b>Отсканируйте штрих-код, добавьте продукт вручную или загрузите базовый набор на вкладке «Продукты».</div>`;

function productListHtml() {
  const items = filterProducts(state.prodSearch);
  if (!state.products.length) return emptyProducts;
  if (!items.length) return `<div class="empty"><b>Ничего не найдено</b>Попробуйте другое название или добавьте новый продукт.</div>`;
  return items.map((p) => productRow(p, "data-edit-product")).join("");
}

function viewProducts() {
  const missing = starterMissing().length;
  return `
    ${pageHead("Общая база", "Продукты", `
      <button type="button" class="iconbtn" data-act="scanProduct" aria-label="Сканировать штрих-код">${SCAN_SVG}</button>
      <button type="button" class="round-btn" data-act="newProduct" aria-label="Новый продукт">+</button>`)}
    <input id="prod-search" class="input search" type="search" placeholder="Название, штрих-код или автор" value="${esc(state.prodSearch)}" autocomplete="off">
    <section class="card list-card"><div id="plist" class="plist">${productListHtml()}</div></section>
    <p class="foot-note">Продукты видят все пользователи. Править или удалять продукт может только тот, кто его добавил.</p>
    ${missing ? `<section class="card">
      <h2 class="h2">Базовые продукты</h2>
      <p class="foot-note" style="margin:0 0 12px">Овощи, мясо, рыба, яйца, крупы, молочные продукты и фрукты: ${missing} позиций со справочными значениями на 100 г. Многие есть в нескольких видах: сырой, варёный, запечённый, жареный. У жареных значения ориентировочные и уже включают типичное количество масла. После добавления их увидят все.</p>
      <button type="button" class="btn ghost full" data-act="importStarter">Добавить в общую базу</button>
    </section>` : ""}`;
}

/* ================= Отчёты ================= */
function viewReports() {
  const n = state.repDays;
  const today = todayStr();
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(addDays(today, -i));
  const per = days.map((d) => ({ d, t: sumEntries(entriesOn(d)), has: entriesOn(d).length > 0 }));
  const max = Math.max(state.goal * 1.15, ...per.map((x) => x.t.kcal), 1);
  const bars = per.map((x) => {
    const h = x.has ? Math.max(2, (x.t.kcal / max) * 100) : 0;
    const cls = !x.has ? "b zero" : x.t.kcal > state.goal ? "b over" : "b";
    return `<div class="col"><div class="${cls}" style="height:${x.has ? h : 2}%" title="${dayLabel(x.d)}: ${x.t.kcal} ккал"></div></div>`;
  }).join("");
  const labels = per.map((x, i) => {
    const d = parseD(x.d);
    const text = n === 7 ? WD_SHORT[d.getDay()] : (i % 5 === 0 ? d.getDate() : "");
    return `<span>${text}</span>`;
  }).join("");
  const goalBottom = (state.goal / max) * 100;

  const withData = per.filter((x) => x.has);
  const k = withData.length || 1;
  const avg = withData.reduce((a, x) => ({ kcal: a.kcal + x.t.kcal, protein: a.protein + x.t.protein, fat: a.fat + x.t.fat, carbs: a.carbs + x.t.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

  return `
    ${pageHead("Статистика", "Отчёты")}
    <div class="seg" role="group" aria-label="Период">
      <button type="button" data-act="repDays" data-n="7" class="${n === 7 ? "on" : ""}">7 дней</button>
      <button type="button" data-act="repDays" data-n="30" class="${n === 30 ? "on" : ""}">30 дней</button>
    </div>
    <section class="card">
      <h2 class="h2">Калории по дням</h2>
      <div class="chart">${bars}<div class="goal" style="bottom:${goalBottom}%"></div></div>
      <div class="chart-labels">${labels}</div>
      <p class="chart-note">Пунктир: ваша цель ${fmtInt(state.goal)} ккал. Красным отмечены дни с перебором.</p>
    </section>
    ${barsCard("Вода по дням", days, waterOn, waterTarget, "мл", "water")}
    ${barsCard("Нагрузки по дням", days, actMinutes, null, "мин", "")}
    <section class="card">
      <h2 class="h2">В среднем за день</h2>
      ${withData.length ? `<div class="stat-grid">
        <div class="stat"><b>${fmtInt(avg.kcal / k)}</b><span>ккал</span></div>
        <div class="stat"><b>${fmt(avg.protein / k)} г</b><span>белки</span></div>
        <div class="stat"><b>${fmt(avg.fat / k)} г</b><span>жиры</span></div>
        <div class="stat"><b>${fmt(avg.carbs / k)} г</b><span>углеводы</span></div>
      </div><p class="chart-note">Считается по дням, в которые есть записи: ${withData.length} из ${n}.</p>`
      : `<div class="empty"><b>Пока нет данных</b>Запишите еду в дневнике, и здесь появится статистика.</div>`}
    </section>`;
}

/* ================= Я ================= */
function viewMe() {
  const u = state.user || {};
  const initial = esc((u.displayName || u.email || "?").trim().charAt(0).toUpperCase());
  const avatar = u.photoURL
    ? `<img class="avatar" src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="avatar">${initial}</div>`;
  return `
    ${pageHead("Профиль", "Я")}
    <section class="card"><div class="me-head">${avatar}<div><div class="me-name">${esc(u.displayName || "Без имени")}</div><div class="me-mail">${esc(u.email || "")}</div></div></div></section>
    ${planCardHtml()}
    <section class="card">
      <h2 class="h2">Дневная цель</h2>
      <label class="field"><span>Калории в день</span><input id="goal-input" class="input" inputmode="numeric" value="${state.goal}" autocomplete="off"></label>
      <button type="button" class="btn primary full" data-act="saveGoal">Сохранить цель</button>
    </section>
    <section class="card">
      <h2 class="h2">Общая база продуктов</h2>
      <p class="foot-note" style="margin:0">Всего продуктов: <b>${state.products.length}</b>. Добавили вы: <b>${state.products.filter((p) => p.createdBy === u.uid).length}</b>. Дневник и цель видите только вы.</p>
    </section>
    <section class="card"><button type="button" class="btn danger full" data-act="logout">Выйти из аккаунта</button></section>`;
}

/* ================= Штрих-коды, Open Food Facts, камера ================= */
const normBC = (s) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");
const OFF_NOTE = "Данные из Open Food Facts. Сверьте с упаковкой и при необходимости поправьте.";
const NEW_BC_NOTE = "Этого продукта нет в общей базе. Введите данные с упаковки один раз: дальше он будет находиться по штрих-коду.";
const OFF_FAIL_NOTE = "Не удалось связаться с Open Food Facts. Введите данные с упаковки вручную.";
const offNum = (v) => { if (v === undefined || v === null || v === "") return ""; const n = Number(v); return Number.isFinite(n) ? r1(n) : ""; };

function normOFF(p, code) {
  const n = p.nutriments || {};
  let kcal = offNum(n["energy-kcal_100g"]);
  const kj = n["energy-kj_100g"];
  if (kcal === "" && kj !== undefined && kj !== null && kj !== "" && Number.isFinite(Number(kj))) kcal = r1(Number(kj) / 4.184);
  return {
    name: String(p.product_name_ru || p.product_name || "").trim(),
    brand: String(p.brands || "").split(",")[0].trim(),
    barcode: String(code || p.code || ""),
    kcal, protein: offNum(n.proteins_100g), fat: offNum(n.fat_100g), carbs: offNum(n.carbohydrates_100g),
  };
}

async function fetchJson(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    let json = null;
    try { json = await r.json(); } catch { /* не JSON */ }
    return { status: r.status, json };
  } catch (e) {
    console.warn("Запрос не удался:", url, e);
    return { error: true };
  } finally {
    clearTimeout(t);
  }
}

const OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments";

async function fetchOFF(code) {
  const r = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (r.error) return { state: "error" };
  if (r.json && r.json.status === 1 && r.json.product) {
    const d = normOFF(r.json.product, code);
    return d.name || d.kcal !== "" ? { state: "found", data: d } : { state: "none" };
  }
  return r.status === 404 || (r.json && r.json.status === 0) ? { state: "none" } : { state: "error" };
}

// null — ошибка связи, [] — ничего не найдено
async function searchOFF(q) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`;
  const r = await fetchJson(url, 15000);
  if (r.error || !r.json || !Array.isArray(r.json.products)) return null;
  return r.json.products.map((p) => normOFF(p, p.code)).filter((d) => d.name && d.kcal !== "").slice(0, 15);
}

let zxingPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const urls = [
        "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
        "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js",
        "https://unpkg.com/@zxing/library@latest/umd/index.min.js",
      ];
      let i = 0;
      const next = () => {
        if (i >= urls.length) { zxingPromise = null; reject(new Error("zxing-load")); return; }
        const sc = document.createElement("script");
        sc.src = urls[i++];
        sc.onload = () => (window.ZXing ? resolve(window.ZXing) : next());
        sc.onerror = next;
        document.head.appendChild(sc);
      };
      next();
    });
  }
  return zxingPromise;
}

// Распознаватель: сначала встроенный BarcodeDetector браузера, иначе ZXing-C++ (WebAssembly) с CDN.
const BC_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const DETECTOR_URLS = [
  "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.1/dist/es/ponyfill.min.js",
  "https://fastly.jsdelivr.net/npm/barcode-detector@3.2.1/dist/es/ponyfill.min.js",
];
let detectorPromise = null;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ("BarcodeDetector" in window) {
        try {
          const sup = await window.BarcodeDetector.getSupportedFormats();
          if (sup.includes("ean_13")) return new window.BarcodeDetector({ formats: BC_FORMATS.filter((f) => sup.includes(f)) });
        } catch { /* перейдём на WebAssembly */ }
      }
      for (const url of DETECTOR_URLS) {
        try {
          const mod = await import(url);
          const det = new mod.BarcodeDetector({ formats: BC_FORMATS });
          const warm = document.createElement("canvas");
          warm.width = warm.height = 8;
          await det.detect(warm).catch(() => {}); // заранее подгружаем модуль распознавания
          return det;
        } catch (e) { console.warn("Не загрузился распознаватель:", url, e); }
      }
      return null;
    })().then((d) => { if (!d) detectorPromise = null; return d; });
  }
  return detectorPromise;
}

const firstCode = (results) => { const hit = (results || []).find((r) => r && r.rawValue); return hit ? String(hit.rawValue) : null; };

// Живое сканирование: кадр с камеры уменьшается и отправляется на распознавание несколько раз в секунду.
async function startLiveScan(video, onCode, isDone) {
  const det = await getDetector();
  if (!det) return startZXingJs(video, onCode);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* не везде поддерживается */ }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || isDone() || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * k);
      canvas.height = Math.round(video.videoHeight * k);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const code = firstCode(await det.detect(canvas));
      if (code && !isDone()) onCode(code);
    } catch (e) { console.warn("Кадр не распознан:", e); } finally { busy = false; }
  }, 160);
  return () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// Запасной вариант, если не загрузился WebAssembly-распознаватель
async function startZXingJs(video, onCode) {
  const ZX = await loadZXing();
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.BrowserMultiFormatReader(hints, 250);
  await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    video,
    (result) => { if (result) onCode(result.getText()); },
  );
  return () => { try { reader.reset(); } catch { /* ignore */ } };
}

// Распознавание по фотографии (обычная камера телефона даёт чёткий кадр с автофокусом)
async function decodeFromFile(file) {
  const det = await getDetector();
  if (!det) {
    try {
      const ZX = await loadZXing();
      const url = URL.createObjectURL(file);
      try { return (await new ZX.BrowserMultiFormatReader().decodeFromImageUrl(url)).getText(); } finally { URL.revokeObjectURL(url); }
    } catch { return null; }
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  return firstCode(await det.detect(canvas));
}

function openScanner(onCode) {
  const ov = document.createElement("div");
  ov.className = "scanner";
  ov.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scan-frame"></div>
    <button type="button" class="icon-btn scan-close" data-sc-close aria-label="Закрыть">×</button>
    <div class="scan-bottom">
      <p class="scan-hint" id="sc-hint">Запускаю камеру…</p>
      <div id="sc-manual-box" class="row hidden"><input id="sc-code" class="input" inputmode="numeric" placeholder="Цифры под штрих-кодом" autocomplete="off"><button type="button" class="btn primary" id="sc-go">Найти</button></div>
      <button type="button" class="btn primary full" id="sc-photo-btn">Сфотографировать код</button>
      <button type="button" class="btn ghost full" id="sc-manual">Ввести код вручную</button>
      <input type="file" accept="image/*" capture="environment" id="sc-photo" class="vh">
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add("noscroll");
  const video = $("video", ov);
  const setHint = (t) => { const h = $("#sc-hint", ov); if (h) h.textContent = t; };
  let cleanup = null;
  let done = false;

  const stop = () => {
    done = true;
    try { cleanup && cleanup(); } catch { /* ignore */ }
    ov.remove();
    if (!document.querySelector(".overlay")) document.body.classList.remove("noscroll");
  };
  const finish = (code) => { if (done) return; stop(); onCode(code); };

  ov.addEventListener("click", (e) => { if (e.target.closest("[data-sc-close]")) stop(); });
  $("#sc-manual", ov).addEventListener("click", () => {
    $("#sc-manual-box", ov).classList.remove("hidden");
    $("#sc-manual", ov).classList.add("hidden");
    $("#sc-code", ov).focus();
  });
  $("#sc-go", ov).addEventListener("click", () => {
    const code = $("#sc-code", ov).value.replace(/\s+/g, "");
    if (!/^\d{6,14}$/.test(code)) { toast("Введите только цифры штрих-кода (от 6 до 14)"); return; }
    finish(code);
  });
  $("#sc-photo-btn", ov).addEventListener("click", () => $("#sc-photo", ov).click());
  $("#sc-photo", ov).addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setHint("Читаю фото…");
    try {
      const code = await decodeFromFile(file);
      if (done) return;
      if (code) finish(code);
      else setHint("Код на фото не распознан. Сфотографируйте ближе, ровно и при хорошем свете или введите код вручную.");
    } catch (err) {
      console.error("Фото:", err);
      if (!done) setHint("Не удалось прочитать фото. Введите код вручную.");
    }
  });

  (async () => {
    try {
      const c = await startLiveScan(video, finish, () => done);
      if (done) { try { c && c(); } catch { /* ignore */ } return; }
      cleanup = c;
      setHint("Держите код ровно в рамке, на расстоянии 15–20 см. Не читается: нажмите «Сфотографировать код».");
    } catch (err) {
      if (done) return;
      console.error("Сканер:", err);
      setHint(err && err.name === "NotAllowedError"
        ? "Нет доступа к камере. Разрешите камеру для этого сайта в настройках телефона или введите код вручную."
        : "Не удалось запустить камеру. Нажмите «Сфотографировать код» или введите код вручную.");
    }
  })();
}

// Найти продукт по штрих-коду: сначала у себя, потом в Open Food Facts, иначе ручной ввод.
async function processBarcode(code, onOwn, onSaved) {
  const own = state.products.find((p) => normBC(p.barcode) === normBC(code));
  if (own) { onOwn(own); return; }
  toast("Ищу в Open Food Facts…");
  const r = await fetchOFF(code);
  if (r.state === "found") openProductForm(null, onSaved, { ...r.data, source: "off", note: OFF_NOTE });
  else if (r.state === "none") openProductForm(null, onSaved, { barcode: code, note: NEW_BC_NOTE });
  else openProductForm(null, onSaved, { barcode: code, note: OFF_FAIL_NOTE });
}

const starterMissing = () => {
  const have = new Set(state.products.map((p) => fold(p.name)));
  return STARTER.filter((x) => !have.has(fold(x[0])));
};

/* ================= Окна снизу ================= */
function openSheet(html) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    ov.classList.remove("open");
    setTimeout(() => { ov.remove(); if (!document.querySelector(".overlay")) document.body.classList.remove("noscroll"); }, 200);
  };
  ov.close = close;
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) close(); });
  document.body.appendChild(ov);
  document.body.classList.add("noscroll");
  requestAnimationFrame(() => ov.classList.add("open"));
  return ov;
}

const mealOptions = (sel) => MEALS.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${m.name}</option>`).join("");

function previewHtml(per100, grams) {
  if (!(grams > 0)) return `<div class="pv-kcal">0<small>ккал</small></div><div class="pv-macros"><div><b>0</b>белки, г</div><div><b>0</b>жиры, г</div><div><b>0</b>углеводы, г</div></div>`;
  const c = calc(per100, grams);
  return `<div class="pv-kcal">${fmtInt(c.kcal)}<small>ккал</small></div>
    <div class="pv-macros"><div><b>${fmt(c.protein)}</b>белки, г</div><div><b>${fmt(c.fat)}</b>жиры, г</div><div><b>${fmt(c.carbs)}</b>углеводы, г</div></div>`;
}

/* ----- Добавление еды в дневник ----- */
function openAddFood(mealId, presetProduct) {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Добавить еду</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <label class="field"><span>Приём пищи</span><select id="af-meal" class="input">${mealOptions(mealId)}</select></label>
    <div id="af-body"></div>`);
  const body = $("#af-body", ov);
  let q = "";

  function showList() {
    body.innerHTML = `
      <button type="button" class="btn primary full scan-cta" id="af-scan">${SCAN_SVG}<span>Сканировать штрих-код</span></button>
      <input id="af-q" class="input search" type="search" placeholder="Найти в общей базе" value="${esc(q)}" autocomplete="off">
      <div id="af-list" class="plist"></div>
      <div id="af-off"></div>
      <button type="button" class="btn ghost full" id="af-new" style="margin-top:12px">+ Новый продукт</button>`;
    const draw = () => {
      const items = filterProducts(q).slice(0, 60);
      $("#af-list", ov).innerHTML = items.length ? items.map((p) => productRow(p, "data-pick")).join("") : (state.products.length ? `<div class="empty"><b>Ничего не найдено</b>Поищите в Open Food Facts или добавьте продукт вручную.</div>` : emptyProducts);
      const term = q.trim();
      $("#af-off", ov).innerHTML = term.length >= 3 ? `<button type="button" class="btn ghost full" id="af-off-btn" style="margin-top:12px">Искать «${esc(term)}» в Open Food Facts</button>` : "";
      const ob = $("#af-off-btn", ov);
      if (ob) ob.addEventListener("click", () => showOff(term));
    };
    draw();
    $("#af-q", ov).addEventListener("input", (e) => { q = e.target.value; draw(); });
    $("#af-scan", ov).addEventListener("click", () => openScanner((code) => processBarcode(code, showDetail, showDetail)));
    $("#af-new", ov).addEventListener("click", () => openProductForm(null, (p) => showDetail(p), { name: q.trim() }));
    $("#af-list", ov).addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      const p = state.products.find((x) => x.id === b.dataset.pick);
      if (p) showDetail(p);
    });
  }

  async function showOff(term) {
    body.innerHTML = `<div class="empty"><b>Ищу в Open Food Facts…</b>Это может занять несколько секунд.</div>`;
    const res = await searchOFF(term);
    if (!ov.isConnected) return;
    if (!res || !res.length) {
      body.innerHTML = `<div class="empty"><b>${res ? "Ничего не найдено" : "Поиск сейчас недоступен"}</b>${res ? "Попробуйте другое название или добавьте продукт вручную." : "Попробуйте позже, отсканируйте штрих-код или добавьте продукт вручную."}</div>
        <button type="button" class="btn ghost full" id="af-back2">Назад</button>`;
      $("#af-back2", ov).addEventListener("click", showList);
      return;
    }
    body.innerHTML = `<div class="plist">${res.map((d, i) => `
      <button type="button" class="prow" data-off-i="${i}">
        <span><span class="p-name">${esc(d.name)}</span><span class="p-macros">${macrosHtml(d.protein || 0, d.fat || 0, d.carbs || 0)}</span>${d.brand ? `<span class="p-sub">${esc(d.brand)}</span>` : ""}</span>
        <span class="p-kcal">${fmtInt(d.kcal)}<small>ккал / 100 г</small></span></button>`).join("")}</div>
      <button type="button" class="btn ghost full" id="af-back2" style="margin-top:12px">Назад</button>`;
    $("#af-back2", ov).addEventListener("click", showList);
    body.querySelectorAll("[data-off-i]").forEach((b) => b.addEventListener("click", () => {
      const d = res[Number(b.dataset.offI)];
      openProductForm(null, showDetail, { ...d, source: "off", note: OFF_NOTE });
    }));
  }

  function showDetail(p) {
    const last = Number(lsGet(`g:${p.id}`)) || 100;
    body.innerHTML = `
      <div class="picked"><div class="p-name">${esc(p.name)}</div><div class="p-sub">${esc(per100Text(p))}</div></div>
      <label class="field"><span>Вес, г</span><input id="af-g" class="input big" inputmode="decimal" value="${last}" autocomplete="off"></label>
      <div class="chips">${[50, 100, 150, 200, 250].map((n) => `<button type="button" class="chip" data-g="${n}">${n}</button>`).join("")}</div>
      <div class="preview" id="af-prev"></div>
      <div class="row"><button type="button" class="btn ghost" id="af-back">Назад</button><button type="button" class="btn primary grow" id="af-add">Добавить</button></div>`;
    const input = $("#af-g", ov);
    const p100 = per100Of(p);
    const upd = () => { $("#af-prev", ov).innerHTML = previewHtml(p100, num(input.value)); };
    upd();
    input.addEventListener("input", upd);
    input.focus(); input.select();
    body.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = c.dataset.g; upd(); }));
    $("#af-back", ov).addEventListener("click", showList);
    $("#af-add", ov).addEventListener("click", () => {
      const grams = num(input.value);
      if (!(grams > 0)) { toast("Введите вес в граммах"); return; }
      lsSet(`g:${p.id}`, String(grams));
      const meal = $("#af-meal", ov).value;
      addDoc(colRef("entries"), {
        date: state.date, meal, productId: p.id, name: p.name, brand: p.brand || "",
        grams, per100: p100, ...calc(p100, grams), createdAt: serverTimestamp(),
      }).catch(writeFail);
      ov.close();
      toast("Добавлено");
    });
  }

  if (presetProduct) showDetail(presetProduct); else showList();
}

/* ----- Редактирование записи ----- */
function openEditEntry(entry) {
  const p100 = entry.per100 || (entry.grams > 0 ? {
    kcal: (entry.kcal / entry.grams) * 100, protein: (entry.protein / entry.grams) * 100,
    fat: (entry.fat / entry.grams) * 100, carbs: (entry.carbs / entry.grams) * 100,
  } : { kcal: 0, protein: 0, fat: 0, carbs: 0 });
  const ov = openSheet(`
    <div class="sheet-head"><h2>Запись</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="picked"><div class="p-name">${esc(entry.name)}</div>${entry.brand ? `<div class="p-sub">${esc(entry.brand)}</div>` : ""}</div>
    <label class="field"><span>Приём пищи</span><select id="ee-meal" class="input">${mealOptions(entry.meal)}</select></label>
    <label class="field"><span>Вес, г</span><input id="ee-g" class="input big" inputmode="decimal" value="${String(entry.grams).replace(".", ",")}" autocomplete="off"></label>
    <div class="preview" id="ee-prev"></div>
    <div class="row"><button type="button" class="btn danger" id="ee-del">Удалить</button><button type="button" class="btn primary grow" id="ee-save">Сохранить</button></div>`);
  const input = $("#ee-g", ov);
  const upd = () => { $("#ee-prev", ov).innerHTML = previewHtml(p100, num(input.value)); };
  upd();
  input.addEventListener("input", upd);
  $("#ee-save", ov).addEventListener("click", () => {
    const grams = num(input.value);
    if (!(grams > 0)) { toast("Введите вес в граммах"); return; }
    updateDoc(docRef("entries", entry.id), { grams, meal: $("#ee-meal", ov).value, per100: p100, ...calc(p100, grams) }).catch(writeFail);
    ov.close();
  });
  $("#ee-del", ov).addEventListener("click", () => {
    if (!confirm(`Удалить «${entry.name}» из дневника?`)) return;
    deleteDoc(docRef("entries", entry.id)).catch(writeFail);
    ov.close();
    toast("Удалено");
  });
}

/* ----- Форма продукта ----- */
function openProductForm(product, onSaved, prefill = {}) {
  const uid = state.user.uid;
  const ro = !!product && product.createdBy !== uid; // чужой продукт: только просмотр
  const p = product || { name: "", brand: "", barcode: "", kcal: "", protein: "", fat: "", carbs: "", ...prefill };
  const note = ro
    ? `Добавил(а): ${product.createdByName || "другой пользователь"}. Править и удалять продукт может только автор.`
    : (product ? "" : (prefill.note || ""));
  const val = (v) => (v === "" || v == null ? "" : String(v).replace(".", ","));
  const dis = ro ? "disabled" : "";
  const barcodeField = ro
    ? `<input id="pf-barcode" class="input" value="${esc(p.barcode || "")}" disabled>`
    : `<div class="inline"><input id="pf-barcode" class="input" inputmode="numeric" maxlength="20" value="${esc(p.barcode || "")}" autocomplete="off"><button type="button" class="icon-btn" id="pf-scan" aria-label="Сканировать штрих-код">${SCAN_SVG}</button></div>`;
  const ov = openSheet(`
    <div class="sheet-head"><h2>${product ? "Продукт" : "Новый продукт"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    <label class="field"><span>Название</span><input id="pf-name" class="input" maxlength="120" ${dis} value="${esc(p.name)}" autocomplete="off" placeholder="Например, Картофель варёный"></label>
    <label class="field"><span>Бренд (необязательно)</span><input id="pf-brand" class="input" maxlength="80" ${dis} value="${esc(p.brand || "")}" autocomplete="off"></label>
    <div class="field"><span>Штрих-код (необязательно)</span>${barcodeField}</div>
    <div class="field"><span>Значения на 100 г</span></div>
    <div class="field-grid">
      <label class="field"><span>Калории, ккал</span><input id="pf-kcal" class="input" inputmode="decimal" ${dis} value="${val(p.kcal)}" autocomplete="off"></label>
      <label class="field"><span>Белки, г</span><input id="pf-protein" class="input" inputmode="decimal" ${dis} value="${val(p.protein)}" autocomplete="off"></label>
      <label class="field"><span>Жиры, г</span><input id="pf-fat" class="input" inputmode="decimal" ${dis} value="${val(p.fat)}" autocomplete="off"></label>
      <label class="field"><span>Углеводы, г</span><input id="pf-carbs" class="input" inputmode="decimal" ${dis} value="${val(p.carbs)}" autocomplete="off"></label>
    </div>
    <div class="row">${ro
      ? `<button type="button" class="btn ghost full" data-close>Закрыть</button>`
      : `${product ? `<button type="button" class="btn danger" id="pf-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="pf-save">Сохранить</button>`}</div>`);

  if (ro) return;

  $("#pf-scan", ov).addEventListener("click", () => openScanner(async (code) => {
    $("#pf-barcode", ov).value = code;
    const dup = state.products.find((x) => normBC(x.barcode) === normBC(code) && (!product || x.id !== product.id));
    if (dup) { toast(`Этот штрих-код уже есть в общей базе: ${dup.name}`); return; }
    const empty = !$("#pf-name", ov).value.trim() && !$("#pf-kcal", ov).value.trim();
    if (product || !empty) return;
    toast("Ищу в Open Food Facts…");
    const r = await fetchOFF(code);
    if (!ov.isConnected) return;
    if (r.state === "found") {
      const d = r.data;
      $("#pf-name", ov).value = d.name; $("#pf-brand", ov).value = d.brand;
      $("#pf-kcal", ov).value = val(d.kcal); $("#pf-protein", ov).value = val(d.protein);
      $("#pf-fat", ov).value = val(d.fat); $("#pf-carbs", ov).value = val(d.carbs);
      toast("Данные найдены. Сверьте их с упаковкой.");
    } else {
      toast(r.state === "none" ? "В базе нет этого кода. Введите данные с упаковки." : "Не удалось связаться с Open Food Facts.");
    }
  }));

  $("#pf-save", ov).addEventListener("click", () => {
    const name = $("#pf-name", ov).value.trim();
    const brand = $("#pf-brand", ov).value.trim();
    const barcode = $("#pf-barcode", ov).value.replace(/\D/g, "");
    const kcal = num($("#pf-kcal", ov).value);
    const opt = (id) => { const v = $(id, ov).value.trim(); return v === "" ? 0 : num(v); };
    const protein = opt("#pf-protein"), fat = opt("#pf-fat"), carbs = opt("#pf-carbs");
    if (!name) { toast("Введите название"); return; }
    if (!Number.isFinite(kcal)) { toast("Введите калории на 100 г"); return; }
    if ([protein, fat, carbs].some((x) => !Number.isFinite(x))) { toast("Белки, жиры и углеводы: введите число"); return; }
    if (kcal > 1000) { toast("Калории на 100 г: не больше 1000"); return; }
    if ([protein, fat, carbs].some((x) => x > 100)) { toast("Белки, жиры и углеводы на 100 г: не больше 100"); return; }
    if (barcode) {
      const dup = state.products.find((x) => normBC(x.barcode) === normBC(barcode) && (!product || x.id !== product.id));
      if (dup) { toast(`Этот штрих-код уже есть в общей базе: ${dup.name}`); return; }
    }
    const data = { name, brand, barcode, kcal, protein, fat, carbs, updatedAt: serverTimestamp() };
    if (product) {
      updateDoc(prodDoc(product.id), data).catch(writeFail);
      ov.close();
      if (onSaved) onSaved({ ...product, ...data });
    } else {
      const source = prefill.source || "user";
      const id = productIdFor({ barcode, source, name });
      const ref = id ? prodDoc(id) : doc(prodCol());
      const full = { ...data, source, ...authorFields(), createdAt: serverTimestamp() };
      setDoc(ref, full).catch(writeFail);
      ov.close();
      toast("Продукт сохранён в общую базу");
      if (onSaved) onSaved({ id: ref.id, ...full });
    }
  });

  if (product) {
    $("#pf-del", ov).addEventListener("click", () => {
      if (!confirm(`Удалить продукт «${product.name}» из общей базы? Записи в дневниках останутся.`)) return;
      deleteDoc(prodDoc(product.id)).catch(writeFail);
      ov.close();
      toast("Продукт удалён");
    });
  }
}

/* ================= Здоровье: вода, нагрузки, профиль ================= */
const currentPlan = () => computePlan(state.profile);
const waterOn = (d) => { const x = state.water.find((w) => w.date === d); return x ? Number(x.ml) || 0 : 0; };
const actOn = (d) => state.activity.filter((a) => a.date === d);
const actMinutes = (d) => actOn(d).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
const actBurned = (d) => actOn(d).reduce((sum, a) => sum + (Number(a.kcal) || 0), 0);
const waterBase = () => (Number(state.profile.waterBaseMl) > 0 ? Number(state.profile.waterBaseMl) : 2000);
// Норма воды растёт с нагрузкой: примерно 500 мл на час тренировки
const waterTarget = (d) => Math.round((waterBase() + actMinutes(d) * 8) / 50) * 50;
const userWeight = () => (Number(state.profile.weightKg) > 0 ? Number(state.profile.weightKg) : 70);
const weekDays = (s) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i));

const dayNavButtons = (day) => `
  <button type="button" class="iconbtn" data-act="prevDay" aria-label="Предыдущий день" ${day <= minDate() ? "disabled" : ""}>${CHEV_L}</button>
  <button type="button" class="chip-btn" data-act="today">${dateShort(day)}</button>
  <button type="button" class="iconbtn" data-act="nextDay" aria-label="Следующий день">${CHEV_R}</button>`;

const fillProfilePrompt = `<section class="card">
  <h2 class="h2">Настройте план</h2>
  <p class="foot-note" style="margin:0 0 12px">Укажите пол, возраст, рост, вес и цель: приложение рассчитает калории, БЖУ, норму воды и рекомендации по нагрузке.</p>
  <button type="button" class="btn primary full" data-act="openProfile">Заполнить данные</button>
</section>`;

// Две плитки в дневнике: вода и нагрузка за выбранный день
function miniTiles(day) {
  const ml = waterOn(day), tg = waterTarget(day);
  const mins = actMinutes(day), burned = actBurned(day);
  const plan = currentPlan();
  const dayGoal = plan ? Math.ceil(plan.weekly.minutes / 7) : 30;
  return `<div class="mini-row">
    <button type="button" class="mini water" data-act="goTab" data-tab="health">
      <span class="mini-top"><span class="mini-ic">${DROP_SVG}</span><span class="mini-label">Вода</span></span>
      <span class="mini-val">${fmtInt(ml)}<small>мл</small></span>
      <span class="mini-sub">норма ${fmtInt(tg)} мл</span>
      <span class="mini-bar"><i style="width:${Math.min(100, (ml / tg) * 100)}%"></i></span>
    </button>
    <button type="button" class="mini act" data-act="goTab" data-tab="health">
      <span class="mini-top"><span class="mini-ic">${PULSE_SVG}</span><span class="mini-label">Нагрузка</span></span>
      <span class="mini-val">${fmtInt(mins)}<small>мин</small></span>
      <span class="mini-sub">сожжено ${fmtInt(burned)} ккал</span>
      <span class="mini-bar"><i style="width:${Math.min(100, (mins / dayGoal) * 100)}%"></i></span>
    </button>
  </div>`;
}

function viewHealth() {
  const day = state.date;
  const plan = currentPlan();
  const ml = waterOn(day), tg = waterTarget(day);
  const extra = actMinutes(day) * 8;
  const left = tg - ml;
  const acts = actOn(day).sort((a, b) => createdMs(a) - createdMs(b));
  const mins = actMinutes(day), burned = actBurned(day);
  const wk = weekDays(day);
  const wkMin = wk.reduce((sum, d) => sum + actMinutes(d), 0);
  const wkStr = wk.reduce((sum, d) => sum + actOn(d).filter((a) => a.type === "strength").length, 0);
  const wt = plan ? plan.weekly : { minutes: 150, strength: 2, text: WEEKLY.maintain.text };
  const actRows = acts.map((a) => `
    <button type="button" class="entry" data-act="editActivity" data-id="${esc(a.id)}">
      <span class="e-main"><span class="e-name">${esc(a.name)}</span><span class="e-sub">${fmt(a.minutes)} мин</span></span>
      <span class="e-kcal">${fmtInt(a.kcal)}<small>ккал</small></span>
    </button>`).join("");
  return `
    ${pageHead("Здоровье", dayLabel(day), dayNavButtons(day))}
    ${plan ? "" : fillProfilePrompt}
    <section class="card">
      <div class="card-top"><h2 class="h2">Вода</h2><span class="pill">норма ${fmtInt(tg)} мл</span></div>
      <div class="big-line">${fmtInt(ml)}<small>мл</small></div>
      <div class="track water"><i style="width:${Math.min(100, (ml / tg) * 100)}%"></i></div>
      <p class="foot-note" style="margin:10px 0 12px">${left > 0 ? `Осталось выпить ${fmtInt(left)} мл.` : "Норма на сегодня выполнена."}${extra ? ` В норму добавлено ${fmtInt(Math.round(extra / 50) * 50)} мл за нагрузку.` : ""}</p>
      <div class="chips">
        ${[150, 250, 330, 500].map((n) => `<button type="button" class="chip water" data-act="addWater" data-ml="${n}">+${n}</button>`).join("")}
        <button type="button" class="chip" data-act="waterCustom">Другое</button>
        <button type="button" class="chip muted" data-act="addWater" data-ml="-250">−250</button>
      </div>
    </section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Нагрузки</h2><button type="button" class="btn ghost sm" data-act="addActivity">+ Добавить</button></div>
      <div class="stat-grid">
        <div class="stat"><b>${fmtInt(mins)}</b><span>минут за день</span></div>
        <div class="stat"><b>${fmtInt(burned)}</b><span>ккал сожжено</span></div>
      </div>
      ${actRows ? `<div class="entries flat">${actRows}</div>` : `<p class="foot-note" style="margin:12px 4px 0">Пока нет записей. Добавьте прогулку, тренировку или любую нагрузку.</p>`}
    </section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Неделя</h2><span class="pill">${fmtInt(wkMin)} из ${wt.minutes} мин</span></div>
      <div class="track"><i style="width:${Math.min(100, (wkMin / wt.minutes) * 100)}%"></i></div>
      <p class="foot-note" style="margin:12px 0 0">Силовых тренировок: <b>${wkStr}</b> из ${wt.strength}. ${esc(wt.text)}</p>
    </section>`;
}

function chartLabels(days) {
  return days.map((d, i) => {
    const dt = parseD(d);
    const t = state.repDays === 7 ? WD_SHORT[dt.getDay()] : (i % 5 === 0 ? dt.getDate() : "");
    return `<span>${t}</span>`;
  }).join("");
}

function barsCard(title, days, valFn, goalFn, unit, cls) {
  const vals = days.map(valFn);
  const goal = goalFn ? Math.max(...days.map(goalFn)) : 0;
  const max = Math.max(goal * 1.15, ...vals, 1);
  const bars = vals.map((v) => `<div class="col"><div class="b ${v > 0 ? cls : "zero"}" style="height:${v > 0 ? Math.max(2, (v / max) * 100) : 2}%"></div></div>`).join("");
  const withData = vals.filter((v) => v > 0);
  const avg = withData.length ? withData.reduce((a, b) => a + b, 0) / withData.length : 0;
  return `<section class="card"><h2 class="h2">${title}</h2>
    <div class="chart">${bars}${goal > 0 ? `<div class="goal" style="bottom:${(goal / max) * 100}%"></div>` : ""}</div>
    <div class="chart-labels">${chartLabels(days)}</div>
    <p class="chart-note">${withData.length ? `В среднем за день с записями: <b>${fmtInt(avg)} ${unit}</b>.` : "Пока нет данных."}${goal > 0 ? ` Пунктир: норма (${fmtInt(goal)} ${unit}).` : ""}</p></section>`;
}

function planCardHtml() {
  const pr = state.profile, plan = currentPlan();
  if (!plan) return fillProfilePrompt;
  const lvl = LEVELS.find((l) => l.v === pr.activity) || LEVELS[0];
  const warns = plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("");
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Мой план</h2><button type="button" class="btn ghost sm" data-act="openProfile">Изменить</button></div>
    <p class="foot-note" style="margin:0 0 12px">Пол: ${pr.sex === "male" ? "мужской" : "женский"}, ${fmt(pr.age)} лет, ${fmt(pr.heightCm)} см, ${fmt(pr.weightKg)} кг. Цель: ${GOAL_NAME[pr.goal]}. ${esc(lvl.t)}.</p>
    <div class="stat-grid">
      <div class="stat"><b>${fmtInt(plan.kcal)}</b><span>ккал в день</span></div>
      <div class="stat"><b>${fmtInt(plan.water)} мл</b><span>воды в день</span></div>
      <div class="stat"><b>${plan.protein} г</b><span>белки в день</span></div>
      <div class="stat"><b>${plan.fat} г</b><span>жиры в день</span></div>
      <div class="stat"><b>${plan.carbs} г</b><span>углеводы в день</span></div>
      <div class="stat"><b>${fmt(plan.bmi)}</b><span>индекс массы тела: ${plan.bmiLabel}</span></div>
    </div>
    <p class="foot-note" style="margin:12px 0 0">Основной обмен: ${fmtInt(plan.bmr)} ккал, расход с учётом образа жизни: ${fmtInt(plan.tdee)} ккал. ${esc(plan.weekly.text)} Это примерно ${fmtInt(plan.weekly.kcal)} ккал в неделю.</p>
    ${warns}
    <p class="foot-note" style="margin:12px 0 0">Индекс массы тела не учитывает мышечную массу. Все значения ориентировочные, для здоровых взрослых, и не заменяют рекомендацию врача. При беременности, диабете и других заболеваниях согласуйте питание и нагрузку с врачом.</p>
  </section>`;
}

function previewPlanHtml(plan) {
  return `<div class="pv-kcal">${fmtInt(plan.kcal)}<small>ккал в день</small></div>
    <div class="pv-macros"><div><b>${plan.protein}</b>белки, г</div><div><b>${plan.fat}</b>жиры, г</div><div><b>${plan.carbs}</b>углеводы, г</div></div>
    <p class="foot-note" style="margin:10px 0 0">Вода: <b>${fmtInt(plan.water)} мл</b> в день. Нагрузка: <b>${plan.weekly.minutes} мин</b> в неделю.</p>
    ${plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}`;
}

// Окно «Мои данные»: при первом входе и по кнопке «Изменить»
function openProfile(first) {
  const pr = state.profile;
  const st = { sex: pr.sex || "", goal: pr.goal || "" };
  const seg = (name, opts, cur) => `<div class="seg full" data-seg="${name}">${opts.map((o) => `<button type="button" data-v="${o.v}" class="${o.v === cur ? "on" : ""}">${o.t}</button>`).join("")}</div>`;
  const val = (v) => (v ? String(v).replace(".", ",") : "");
  const ov = openSheet(`
    <div class="sheet-head"><h2>${first ? "Давайте познакомимся" : "Мои данные"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <p class="foot-note" style="margin:-4px 2px 14px">По этим данным приложение рассчитает калории, БЖУ, норму воды и рекомендации по нагрузке. Возраст нужен для точности расчёта.</p>
    <div class="field"><span>Пол</span>${seg("sex", SEX, st.sex)}</div>
    <div class="field-grid3">
      <label class="field"><span>Возраст, лет</span><input id="pr-age" class="input" inputmode="numeric" value="${val(pr.age)}" autocomplete="off"></label>
      <label class="field"><span>Рост, см</span><input id="pr-h" class="input" inputmode="decimal" value="${val(pr.heightCm)}" autocomplete="off"></label>
      <label class="field"><span>Вес, кг</span><input id="pr-w" class="input" inputmode="decimal" value="${val(pr.weightKg)}" autocomplete="off"></label>
    </div>
    <div class="field"><span>Цель</span>${seg("goal", GOALS, st.goal)}</div>
    <label class="field"><span>Образ жизни</span><select id="pr-level" class="input">${LEVELS.map((l) => `<option value="${l.v}" ${l.v === (pr.activity || "light") ? "selected" : ""}>${l.t}</option>`).join("")}</select></label>
    <div class="preview" id="pr-prev"></div>
    <div class="row">${first ? `<button type="button" class="btn ghost" id="pr-skip">Позже</button>` : ""}<button type="button" class="btn primary grow" id="pr-save">Рассчитать и сохранить</button></div>`);

  const read = () => ({ sex: st.sex, goal: st.goal, age: num($("#pr-age", ov).value), heightCm: num($("#pr-h", ov).value), weightKg: num($("#pr-w", ov).value), activity: $("#pr-level", ov).value });
  const upd = () => {
    const d = read(), plan = computePlan(d), box = $("#pr-prev", ov);
    if (plan) box.innerHTML = previewPlanHtml(plan);
    else if (Number.isFinite(d.age) && d.age < 18) box.innerHTML = `<p class="foot-note" style="margin:0">Расчёт сделан для взрослых, от 18 лет.</p>`;
    else box.innerHTML = `<p class="foot-note" style="margin:0">Заполните все поля, и здесь появится ваш план.</p>`;
  };
  upd();
  ov.addEventListener("input", upd);
  ov.addEventListener("change", upd);
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-seg] [data-v]");
    if (!b) return;
    st[b.parentElement.dataset.seg] = b.dataset.v;
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    upd();
  });
  if (first) $("#pr-skip", ov).addEventListener("click", () => { lsSet(`ob_skip_${state.user.uid}`, "1"); ov.close(); });
  $("#pr-save", ov).addEventListener("click", () => {
    const d = read(), plan = computePlan(d);
    if (!plan) { toast(Number.isFinite(d.age) && d.age < 18 ? "Расчёт сделан для взрослых, от 18 лет" : "Заполните пол, возраст, рост, вес и цель"); return; }
    setDoc(docRef("settings", "profile"), {
      sex: d.sex, age: d.age, heightCm: d.heightCm, weightKg: d.weightKg, goal: d.goal, activity: d.activity,
      goalKcal: plan.kcal, goalProtein: plan.protein, goalFat: plan.fat, goalCarbs: plan.carbs, waterBaseMl: plan.water,
      planUpdatedAt: serverTimestamp(),
    }, { merge: true }).catch(writeFail);
    ov.close();
    toast("План рассчитан и сохранён");
  });
}

// Первый вход: если профиль не заполнен, предлагаем заполнить (один раз за сессию, «Позже» запоминается)
function maybeOnboard() {
  if (state.obShown || !state.user || lsGet(`ob_skip_${state.user.uid}`)) return;
  setTimeout(() => {
    if (state.obShown || !state.user || computePlan(state.profile) || document.querySelector(".overlay, .scanner")) return;
    state.obShown = true;
    openProfile(true);
  }, 700);
}

function changeWater(n) {
  const day = state.date, cur = waterOn(day);
  const ref = doc(db, "users", state.user.uid, "water", day);
  if (n < 0 && cur + n <= 0) setDoc(ref, { date: day, ml: 0 }, { merge: true }).catch(writeFail);
  else setDoc(ref, { date: day, ml: increment(n) }, { merge: true }).catch(writeFail);
  toast(n > 0 ? `Добавлено ${n} мл воды` : "Убрано 250 мл");
}

function openWaterSheet() {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Вода</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <label class="field"><span>Количество, мл</span><input id="wc-ml" class="input big" inputmode="numeric" value="200" autocomplete="off"></label>
    <div class="chips">${[100, 200, 300, 400, 750, 1000].map((n) => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join("")}</div>
    <button type="button" class="btn primary full" id="wc-add">Добавить</button>`);
  const input = $("#wc-ml", ov);
  input.focus(); input.select();
  ov.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = c.dataset.n; }));
  $("#wc-add", ov).addEventListener("click", () => {
    const n = num(input.value);
    if (!(n > 0 && n <= 3000)) { toast("Введите количество воды от 1 до 3000 мл"); return; }
    changeWater(Math.round(n));
    ov.close();
  });
}

function openActivitySheet(entry) {
  const w = userWeight();
  const type0 = entry ? entry.type : "walkfast";
  const ov = openSheet(`
    <div class="sheet-head"><h2>${entry ? "Нагрузка" : "Новая нагрузка"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <label class="field"><span>Вид нагрузки</span><select id="ac-type" class="input">
      ${ACTIVITIES.map((a) => `<option value="${a.id}" ${a.id === type0 ? "selected" : ""}>${a.name}</option>`).join("")}
      <option value="custom" ${type0 === "custom" ? "selected" : ""}>Другое: свои калории</option></select></label>
    <div id="ac-custom" class="hidden">
      <label class="field"><span>Название</span><input id="ac-name" class="input" maxlength="60" value="${entry && entry.type === "custom" ? esc(entry.name) : ""}" autocomplete="off" placeholder="Например, Подтягивания"></label>
      <label class="field"><span>Сожжено, ккал</span><input id="ac-kcal" class="input" inputmode="numeric" value="${entry && entry.type === "custom" ? entry.kcal : ""}" autocomplete="off"></label>
    </div>
    <label class="field"><span>Длительность, мин</span><input id="ac-min" class="input big" inputmode="numeric" value="${entry ? entry.minutes : 30}" autocomplete="off"></label>
    <div class="chips">${[15, 30, 45, 60, 90].map((n) => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join("")}</div>
    <div class="preview" id="ac-prev"></div>
    <p class="foot-note" style="margin:-4px 2px 14px">Калории считаются по формуле: MET × ваш вес (${fmt(w)} кг) × время в часах. Значения ориентировочные.</p>
    <div class="row">${entry ? `<button type="button" class="btn danger" id="ac-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="ac-save">Сохранить</button></div>`);

  const calcNow = () => {
    const type = $("#ac-type", ov).value, min = num($("#ac-min", ov).value);
    $("#ac-custom", ov).classList.toggle("hidden", type !== "custom");
    if (type === "custom") return { type, min, kcal: num($("#ac-kcal", ov).value), met: null, name: $("#ac-name", ov).value.trim() || "Другая нагрузка" };
    const a = ACTIVITIES.find((x) => x.id === type);
    return { type, min, kcal: min > 0 ? Math.round((a.met * w * min) / 60) : NaN, met: a.met, name: a.name };
  };
  const upd = () => {
    const c = calcNow();
    $("#ac-prev", ov).innerHTML = `<div class="pv-kcal">${Number.isFinite(c.kcal) ? fmtInt(c.kcal) : 0}<small>ккал сожжено</small></div>${c.met && c.min > 0 ? `<p class="foot-note" style="margin:8px 0 0">${fmt(c.met)} MET × ${fmt(w)} кг × ${fmt(c.min)} мин ÷ 60</p>` : ""}`;
  };
  upd();
  ov.addEventListener("input", upd);
  ov.addEventListener("change", upd);
  ov.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { $("#ac-min", ov).value = c.dataset.n; upd(); }));
  $("#ac-save", ov).addEventListener("click", () => {
    const c = calcNow();
    if (!(c.min > 0 && c.min <= 600)) { toast("Введите длительность от 1 до 600 минут"); return; }
    if (!Number.isFinite(c.kcal) || c.kcal > 5000) { toast("Введите калории от 0 до 5000"); return; }
    const data = { type: c.type, name: c.name, minutes: c.min, kcal: Math.round(c.kcal), met: c.met };
    if (entry) updateDoc(docRef("activity", entry.id), data).catch(writeFail);
    else addDoc(colRef("activity"), { ...data, date: state.date, createdAt: serverTimestamp() }).catch(writeFail);
    ov.close();
    toast("Нагрузка сохранена");
  });
  if (entry) {
    $("#ac-del", ov).addEventListener("click", () => {
      if (!confirm(`Удалить «${entry.name}»?`)) return;
      deleteDoc(docRef("activity", entry.id)).catch(writeFail);
      ov.close();
      toast("Удалено");
    });
  }
}

/* ================= Обработчики ================= */
const actions = {
  prevDay() { if (state.date > minDate()) { state.date = addDays(state.date, -1); render(); } },
  nextDay() { state.date = addDays(state.date, 1); render(); },
  today() { state.date = todayStr(); render(); },
  pickDay(ds) { if (ds.date >= minDate()) { state.date = ds.date; render(); } },
  addFood(ds) { openAddFood(ds.meal); },
  editEntry(ds) { const e = state.entries.find((x) => x.id === ds.id); if (e) openEditEntry(e); },
  newProduct() { openProductForm(null); },
  goTab(ds) { state.tab = ds.tab; render(); window.scrollTo(0, 0); },
  addWater(ds) { changeWater(Number(ds.ml)); },
  waterCustom() { openWaterSheet(); },
  addActivity() { openActivitySheet(null); },
  editActivity(ds) { const a = state.activity.find((x) => x.id === ds.id); if (a) openActivitySheet(a); },
  openProfile() { openProfile(false); },
  scanProduct() { openScanner((code) => processBarcode(code, (p) => openProductForm(p), null)); },
  importStarter() {
    const items = starterMissing();
    if (!items.length) { toast("Все базовые продукты уже добавлены"); return; }
    if (!confirm(`Добавить ${items.length} базовых продуктов в общую базу? Их увидят все пользователи.`)) return;
    const batch = writeBatch(db);
    items.forEach(([name, kcal, protein, fat, carbs]) => {
      batch.set(prodDoc(`s_${fnv(fold(name))}`), { name, brand: "", barcode: "", kcal, protein, fat, carbs, source: "starter", ...authorFields(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    batch.commit().then(() => toast(`Добавлено продуктов: ${items.length}`)).catch(writeFail);
  },
  repDays(ds) { state.repDays = Number(ds.n) === 30 ? 30 : 7; render(); },
  saveGoal() {
    const g = num($("#goal-input").value);
    if (!(g >= 500 && g <= 10000)) { toast("Введите цель от 500 до 10 000 ккал"); return; }
    setDoc(docRef("settings", "profile"), { goalKcal: Math.round(g) }, { merge: true }).catch(writeFail);
    toast("Цель сохранена");
  },
  logout() { signOut(auth); },
};

$("#view").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit-product]");
  if (edit) {
    const p = state.products.find((x) => x.id === edit.dataset.editProduct);
    if (p) openProductForm(p);
    return;
  }
  const t = e.target.closest("[data-act]");
  if (t && actions[t.dataset.act]) actions[t.dataset.act](t.dataset);
});

$("#view").addEventListener("input", (e) => {
  if (e.target.id === "prod-search") {
    state.prodSearch = e.target.value;
    $("#plist").innerHTML = productListHtml();
  }
});

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

// Опечатки в данных не должны ломать интерфейс молча
window.addEventListener("unhandledrejection", (e) => console.error("Необработанная ошибка:", e.reason));

// Запрет масштабирования жестами на iPhone (щипок); двойное касание блокирует touch-action в CSS
["gesturestart", "gesturechange", "gestureend"].forEach((name) => document.addEventListener(name, (e) => e.preventDefault(), { passive: false }));
