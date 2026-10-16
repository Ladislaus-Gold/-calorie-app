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
  getDocFromServer, getDocsFromServer, limit,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { STARTER } from "./starter.js?v=50";
import { DRINKS, DRINK_CATS, DRINK_BY_ID } from "./drinks.js?v=30";
import * as TR from "./train.js?v=4";

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

// Всплывающие оповещения отключены полностью (по просьбе пользователя): функция оставлена пустой, чтобы не менять вызовы по коду
function toast() {}

const APP_VERSION = 110;

/* ================= Состояние ================= */
const HISTORY_DAYS = 90; // сколько последних дней подписка держит «вживую»; всё, что старше, подгружается по запросу и никогда не удаляется
const FLOOR_DATE = "2020-01-01"; // нижняя граница для календарей
const MEALS = [
  { id: "breakfast", name: "Завтрак", icon: "sunrise", emoji: "🍳" },
  { id: "lunch", name: "Обед", icon: "sun", emoji: "🍲" },
  { id: "dinner", name: "Ужин", icon: "moon", emoji: "🍽️" },
  { id: "snack", name: "Перекус", icon: "apple", emoji: "🍎" },
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
  trainCfg: null, trainLog: [],
  user: null,
  tab: "diary",
  date: todayStr(),
  products: [],
  entries: [],
  goal: 2000,
  repDays: 7,
  repCustom: null,
  ai: { busy: false, error: "", detail: "", step: "" },
  aiLast: null,
  insOpen: false,
  status: { busy: false, ts: 0, server: "", rules: "", latest: 0 },
  fluidOpenDay: null,
  mealOpen: {},
  hist: { entries: [], water: [], activity: [], drinks: [], workouts: [] },
  histFrom: null,
  liveFrom: null,
  histBusy: false,
  prodSearch: "",
  error: "",
  profile: {},
  water: [],
  activity: [],
  health: [],
  workouts: [],
  drinks: [],
  fav: [], customDrinks: [], sharedDrinks: [], drinkdbReady: false, drinkSetReady: false,
  obShown: false,
  ready: { products: false, entries: false, settings: false, water: false, activity: false, drinks: false },
  unsubs: [],
};

const minDate = () => addDays(todayStr(), -HISTORY_DAYS);
// Индексы по дате: пересобираются только когда меняется сам массив данных
const byDateIndex = (() => {
  const cache = new Map();
  return (key) => {
    const arr = state[key];
    let c = cache.get(key);
    if (!c || c.arr !== arr) {
      const m = new Map();
      for (const x of arr) { const l = m.get(x.date); if (l) l.push(x); else m.set(x.date, [x]); }
      c = { arr, m };
      cache.set(key, c);
    }
    return c.m;
  };
})();
// Тема оформления: авто (как в системе) / светлая / тёмная
const themePref = () => lsGet("theme") || "auto";
function applyTheme() {
  const p = themePref();
  const dark = p === "dark" || (p === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.content = dark ? "dark" : "light";
}
try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) { /* старый браузер */ }
applyTheme();
const EMPTY = [];
// Цвет по приближению к цели: до 85% зелёный, 85–100% жёлтый, больше цели красный
const levelOf = (r) => (r > 1 ? "over" : r >= 0.85 ? "near" : "ok");
const entriesOn = (d) => byDateIndex("entries").get(d) || EMPTY;
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
  state.ready = { products: false, entries: false, settings: false, water: false, activity: false, drinks: false };
  state.profile = {}; state.water = []; state.activity = []; state.health = []; state.workouts = []; state.drinks = []; state.fav = []; state.customDrinks = []; state.sharedDrinks = []; state.drinkdbReady = false; state.drinkSetReady = false; state.bcMap = {}; state.bcOwner = {}; state.weights = []; state.hTab = lsGet("hTab") || "today"; state.wtRange = lsGet("wtRange") == null ? 30 : Number(lsGet("wtRange")); state.cafInfo = false; state.rTab = lsGet("rTab") || "over"; state.moreCharts = false; state.openDays = {}; state.openWks = {}; state.obShown = false; state.aiLast = null; state.trainCfg = null; state.trainLog = [];
}

function markReady(name) {
  state.ready[name] = true;
  if (Object.values(state.ready).every(Boolean)) { $("#loading").classList.add("hidden"); runPendingLink(); checkStatus(false); }
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
    upgradeStarterDrinks();
  }, fail));

  const from = minDate();
  state.liveFrom = from;
  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "entries"), where("date", ">=", from)), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.entries);
    markReady("entries"); render();
  }, fail));

  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "profile"), (snap) => {
    state.profile = snap.exists() ? snap.data() : {};
    const g = Number(state.profile.goalKcal);
    state.goal = g > 0 ? g : 2000;
    markReady("settings"); render(); maybeOnboard();
  }, fail));

  state.unsubs.push(onSnapshot(collection(db, "users", uid, "weights"), (snap) => {
    state.weights = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((w) => w.date && Number(w.kg) > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    render();
  }, (err) => console.warn("Вес:", err)));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "water"), where("date", ">=", from)), (snap) => {
    state.water = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.water);
    markReady("water"); render();
  }, fail));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "activity"), where("date", ">=", from)), (snap) => {
    state.activity = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.activity);
    markReady("activity"); render();
  }, fail));

  // Данные из Apple Health (через Health Auto Export и Worker): итоги по дням и тренировки. Не блокируют загрузку приложения
  state.unsubs.push(onSnapshot(collection(db, "users", uid, "health"), (snap) => {
    state.health = snap.docs.map((d) => ({ ...d.data(), id: d.id, date: d.id }));
    render();
  }, (err) => console.warn("Данные Apple Health:", err)));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "workouts"), where("date", ">=", from)), (snap) => {
    state.workouts = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.workouts);
    render();
  }, (err) => console.warn("Тренировки Apple Health:", err)));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "drinks"), where("date", ">=", from)), (snap) => {
    state.drinks = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.drinks);
    markReady("drinks"); render();
  }, fail));

  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "drinks"), (snap) => {
    state.fav = snap.exists() && Array.isArray(snap.data().fav) ? snap.data().fav : [];
    state.customDrinks = snap.exists() && Array.isArray(snap.data().custom) ? snap.data().custom : [];
    state.drinkSetReady = true;
    maybeMigrateDrinks();
    render();
  }, (err) => console.warn("Избранные напитки:", err)));

  // Общая база напитков: видят и добавляют все пользователи
  state.unsubs.push(onSnapshot(collection(db, "drinkdb"), (snap) => {
    state.sharedDrinks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.drinkdbReady = true;
    maybeMigrateDrinks();
    render();
  }, (err) => console.warn("Общая база напитков:", err)));

  // Дополнительные штрих-коды упаковок: код -> id продукта (общая база, видна всем)
  // План тренировок: анкета и отметки (отдельно от workouts/activity, в статистику не попадают)
  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "training"), (snap) => {
    state.trainCfg = snap.exists() ? snap.data() : null;
    render();
  }, (err) => console.error(err)));
  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "trainlog"), where("date", ">=", addDays(todayStr(), -400))), (snap) => {
    state.trainLog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => console.error(err)));

  state.unsubs.push(onSnapshot(collection(db, "barcodes"), (snap) => {
    const m = {}, o = {};
    snap.docs.forEach((d) => { const v = d.data(); if (v && v.productId) { m[d.id] = v.productId; o[d.id] = v.createdBy; } });
    state.bcMap = m; state.bcOwner = o;
    render();
  }, (err) => console.warn("Штрих-коды упаковок:", err)));

  // Последний ответ ИИ: хранится в аккаунте и на устройстве до следующего запуска анализа
  state.aiLast = aiLoadLocal();
  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "ai"), (snap) => {
    const d = snap.exists() ? snap.data() : null;
    if (d && d.text && (!state.aiLast || (d.ts || 0) >= (state.aiLast.ts || 0))) {
      state.aiLast = d;
      lsSet("ai_last", JSON.stringify(d));
    }
    render();
  }, (err) => console.warn("Последний анализ ИИ:", err)));
}

// Старая история: читается один раз по запросу и хранится в памяти (в базе она остаётся навсегда)
let histPromise = Promise.resolve();
function loadHistory(from) {
  histPromise = histPromise.then(async () => {
    const live = state.liveFrom;
    if (!live || !state.user || from >= live) return;
    if (state.histFrom && from >= state.histFrom) return;
    const upper = state.histFrom || live;
    state.histBusy = true; render();
    try {
      const uid = state.user.uid;
      const names = ["entries", "water", "activity", "drinks", "workouts"];
      const res = await Promise.all(names.map((n) => getDocs(query(collection(db, "users", uid, n), where("date", ">=", from), where("date", "<", upper)))));
      names.forEach((n, i) => {
        const rows = res[i].docs.map((d) => ({ id: d.id, ...d.data() }));
        state.hist[n] = state.hist[n].concat(rows);
        state[n] = state[n].concat(rows);
      });
      state.histFrom = from;
    } catch (e) {
      console.warn("История не загрузилась:", e);
      toast("Не удалось загрузить старую историю. Проверьте интернет.");
    } finally { state.histBusy = false; render(); }
  });
  return histPromise;
}
const earliestDate = () => {
  let m = todayStr();
  for (const k of ["entries", "water", "activity", "drinks", "workouts"]) for (const x of state[k]) if (x.date && x.date < m) m = x.date;
  return m;
};

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
// Напитки из базового набора, добавленные раньше, получают гидратацию и кофеин (один раз, только свои)
async function upgradeStarterDrinks() {
  const uid = state.user && state.user.uid;
  if (!uid || state.upgradedFor === uid) return;
  state.upgradedFor = uid;
  try {
    const batch = writeBatch(db);
    let n = 0;
    for (const row of STARTER) {
      const meta = row[5];
      if (!meta) continue;
      const p = state.products.find((x) => fold(x.name) === fold(row[0]) && x.createdBy === uid && x.drink === undefined);
      if (p) { batch.update(prodDoc(p.id), { drink: true, hydrationPct: meta[0], caffeineMg100: meta[1], updatedAt: serverTimestamp() }); n++; }
    }
    if (n) await batch.commit();
  } catch (e) { console.warn("Обновление напитков базового набора:", e); }
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

// Суточные цели по БЖУ (из плана профиля), приведённые к текущей цели по калориям, чтобы граммы и ккал не расходились
// «Главное на сегодня»: одна короткая подсказка по текущему дню (только для сегодняшнего дня с записями)
function dayTipHtml(day, list, t, left, mg) {
  if (day !== todayStr() || !list.length) return "";
  const parts = [];
  const goal = state.goal;
  if (left < -goal * 0.1) {
    parts.push(`Калории превышены на ${fmtInt(-left)} ккал. Остаток дня лучше лёгкий: овощи, нежирный белок и вода, плюс прогулка 20–30 минут.`);
  } else if (mg) {
    const gap = mg.protein - t.protein;
    if (gap > 20 && left > 0) {
      const byName = new Map();
      state.entries.filter((e) => !e.drink && Number(e.grams) > 0 && Number(e.protein) > 0).forEach((e) => {
        const k = fold(e.name), p100 = (e.protein / e.grams) * 100, k100 = (e.kcal / e.grams) * 100;
        const r = byName.get(k) || { name: e.name, n: 0, p100, k100 };
        r.n++; byName.set(k, r);
      });
      const best = [...byName.values()].filter((r) => r.p100 >= 12 && r.k100 <= 260).sort((a, b) => b.n - a.n)[0];
      let hint = " Подойдут творог, яйца, курица или рыба.";
      if (best) {
        const g = Math.min(300, Math.max(50, Math.round(((gap / best.p100) * 100) / 10) * 10));
        hint = ` Например, «${best.name}»: около ${g} г дадут ${fmtInt((g * best.p100) / 100)} г белка.`;
      }
      parts.push(`Белка не хватает ${fmtInt(gap)} г.${hint}`);
    } else if (left > 0) {
      parts.push(`Осталось ${fmtInt(left)} ккал, белок почти набран. Можно добавить овощи или лёгкий перекус.`);
    }
  }
  if (t.kcal > 600 && (t.fat * 9) / t.kcal > 0.45) parts.push(`Жиров уже ${Math.round(((t.fat * 9) / t.kcal) * 100)}% калорий, дальше лучше нежирное, без жареного.`);
  const wt = waterTarget(day), hy = hydrationOn(day);
  if (new Date().getHours() >= 15 && wt > 0 && hy / wt < 0.5 && parts.length < 2) parts.push(`Жидкости выпито ${Math.round((hy / wt) * 100)}% нормы: пора выпить воды.`);
  if (!parts.length) parts.push("День идёт по плану: калории и белок в пределах цели.");
  return `<section class="card day-tip"><span class="dt-ic">★</span><div><b>Главное на сегодня</b><p>${esc(parts.slice(0, 2).join(" "))}</p></div></section>`;
}
function macroGoals() {
  const pf = state.profile, P = Number(pf.goalProtein), F = Number(pf.goalFat), C = Number(pf.goalCarbs);
  if (!(P > 0 && F > 0 && C > 0)) return null;
  const k = P * 4 + F * 9 + C * 4;
  const sc = state.goal > 0 && k > 0 ? state.goal / k : 1;
  return { protein: P * sc, fat: F * sc, carbs: C * sc };
}

// БЖУ приёма пищи: факт, а при наличии плана «из N»; перевыполненное выделяется красным и жирным
function macrosHtml(p, f, c, plan) {
  const one = (name, color, v, g) => {
    const over = g > 0 && v > g;
    return `<span class="mx${over ? " over" : ""}"><i style="background:var(${color})"></i>${name} ${fmt(v)} г${g > 0 ? ` из ${fmtInt(g)} г` : ""}</span>`;
  };
  return one("Белки", "--protein", p, plan && plan.p) + one("Жиры", "--fat", f, plan && plan.f) + one("Углеводы", "--carbs", c, plan && plan.c);
}

function pageHead(overline, title, actions = "") {
  return `<header class="head"><div><div class="overline">${overline}</div><h1 class="title">${title}</h1></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</header>`;
}

// Распределение дневной цели по приёмам пищи (в процентах, сумма всегда 100). Хранится в settings/profile.mealSplit
const MEAL_SPLIT_DEFAULT = { breakfast: 30, lunch: 35, dinner: 25, snack: 10 };
function normalizeSplit(raw) {
  const ids = MEALS.map((m) => m.id);
  const vals = ids.map((id) => Math.max(0, Number(raw && raw[id]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return { ...MEAL_SPLIT_DEFAULT };
  const pct = vals.map((v) => Math.round((v / sum) * 100));
  const diff = 100 - pct.reduce((a, b) => a + b, 0);
  if (diff) pct[pct.indexOf(Math.max(...pct))] += diff;
  return Object.fromEntries(ids.map((id, i) => [id, pct[i]]));
}
const mealSplit = () => normalizeSplit(state.profile.mealSplit || MEAL_SPLIT_DEFAULT);
const mealTarget = (id) => Math.round((state.goal * mealSplit()[id]) / 100);

function splitFieldsHtml() {
  const sp = mealSplit();
  return `<p class="foot-note" style="margin:4px 0 10px">Распределение калорий по приёмам пищи, %. Если сумма не равна 100, при сохранении она приведётся к 100.</p>
    <div class="field-grid">${MEALS.map((m) => `<label class="field"><span>${m.name}, % · ${fmtInt(mealTarget(m.id))} ккал</span><input id="split-${m.id}" class="input" inputmode="numeric" value="${sp[m.id]}" autocomplete="off"></label>`).join("")}</div>`;
}

function viewDiary() {
  const day = state.date;
  const list = entriesOn(day);
  const t = sumEntries(list);
  const min = FLOOR_DATE;

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
  const calLevel = levelOf(t.kcal / state.goal);
  const mg = macroGoals();
  const legend = [
    ["Белки", "var(--protein)", t.protein, pct(kP), mg && Math.round(mg.protein), "protein"],
    ["Углеводы", "var(--carbs)", t.carbs, pct(kC), mg && Math.round(mg.carbs), "carbs"],
    ["Жиры", "var(--fat)", t.fat, pct(kF), mg && Math.round(mg.fat), "fat"],
  ].map(([n, c, g, p, tg, key]) => `<button type="button" class="lg-row" data-act="macroTop" data-key="${key}"><span class="lg-dot" style="background:${c}"></span><span class="lg-name">${n}${tg ? `<small>цель ${fmtInt(tg)} г</small>` : ""}</span><span class="lg-val${tg && g > tg ? " over" : ""}">${fmt(g)} г<small>${p}%</small></span></button>`).join("");

  // приёмы пищи
  const mealsHtml = MEALS.map((m) => {
    const items = list.filter((e) => e.meal === m.id).sort((a, b) => createdMs(a) - createdMs(b));
    const mt = sumEntries(items);
    const target = mealTarget(m.id);
    const mp = target > 0 ? Math.min(100, (mt.kcal / target) * 100) : 0;
    const sh = mealSplit()[m.id] / 100;
    const mplan = mg ? { p: Math.round(mg.protein * sh), f: Math.round(mg.fat * sh), c: Math.round(mg.carbs * sh) } : null;
    const mKey = `${day}:${m.id}`, mOpen = !!state.mealOpen[mKey], shown = mOpen ? items : [];
    if (!items.length) {
      return `<section class="card meal m-${m.id} meal-empty-card"><button type="button" class="meal-empty" data-act="addFood" data-meal="${m.id}"><span class="meal-ic ${m.id}">${m.emoji}</span><span class="me-main"><b>${m.name}</b><small>цель ${fmtInt(target)} ккал, пока пусто</small></span><span class="me-plus">+</span></button></section>`;
    }
    const rows = shown.map((e) => `
      <div class="sw" data-sw="${esc(e.id)}"><div class="sw-bg"><span class="sw-edit">✎ Граммы</span><span class="sw-del">Удалить 🗑</span></div>
      <button type="button" class="entry" data-act="editEntry" data-id="${esc(e.id)}">
        <span class="e-main"><span class="e-name">${esc(e.name)}</span><span class="e-sub">${fmt(e.grams)} ${e.drink ? "мл" : "г"}${e.drink && e.drink.caf100 > 0 ? `, кофеин ${fmtInt((e.grams * e.drink.caf100) / 100)} мг` : ""}${e.brand ? `, ${esc(e.brand)}` : ""}</span></span>
        <span class="e-kcal">${fmtInt(e.kcal)}<small>ккал</small></span>
      </button></div>`).join("");
    return `<section class="card meal m-${m.id}">
      <div class="meal-top" role="button" tabindex="0" data-act="toggleMeal" data-key="${mKey}"><div class="meal-head">
        <span class="meal-ic ${m.id}">${m.emoji}</span>
        <div class="meal-name">${m.name}<span class="meal-chev${mOpen ? " open" : ""}">›</span></div>
        <div class="meal-kcal${mt.kcal > target ? " over" : ""}">${fmtInt(mt.kcal)}<small>из ${fmtInt(target)} ккал</small></div>
        <div class="meal-macros">${macrosHtml(mt.protein, mt.fat, mt.carbs, mplan)}</div>
      </div>
      <div class="meal-plan"><div class="track ${target > 0 ? levelOf(mt.kcal / target) : ""}"><i style="width:${mp}%"></i></div></div></div>
      ${rows ? `<div class="entries">${rows}</div>` : ""}
    </section>`;
  }).join("");

  return `
    ${pageHead("Дневник", dayLabel(day), `
      <button type="button" class="iconbtn" data-act="prevDay" aria-label="Предыдущий день" ${day <= min ? "disabled" : ""}>${CHEV_L}</button>
      <button type="button" class="chip-btn" data-act="today">${dateShort(day)}</button>
      <button type="button" class="iconbtn" data-act="nextDay" aria-label="Следующий день">${CHEV_R}</button>`)}
    <section class="card week"><div class="week-row">${weekHtml}</div><p class="streak">${streakText}</p></section>
    ${trainBannerHtml(day)}
    ${miniTiles(day)}
    <section class="card balance">
      <div class="card-top"><h2 class="h2">Баланс БЖУ</h2><span class="pill">цель ${fmtInt(state.goal)} ккал</span></div>
      <div class="sum-grid">${donut(t)}<div class="legend">${legend}</div></div>
      <div class="cal-sum">
        <div class="cal-row"><span class="cal-lbl">${over ? "Перебор" : "Осталось"}</span><span class="cal-val ${calLevel}">${fmtInt(Math.abs(left))}<small>ккал</small></span></div>
        <div class="track ${calLevel}"><i style="width:${barPct}%"></i></div>
        <div class="cal-foot">Съедено ${fmtInt(t.kcal)} из ${fmtInt(state.goal)} ккал · ${Math.round((t.kcal / state.goal) * 100)}%</div>
      </div>
    </section>
    ${dayTipHtml(day, list, t, left, mg)}
    ${mealsHtml}
    <button type="button" class="fab" data-act="pickMeal" aria-label="Добавить еду">+</button>`;
}

/* ================= Продукты ================= */
const fold = (t) => String(t || "").toLowerCase().replace(/ё/g, "е");
function filterProducts(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return state.products;
  return state.products.filter((p) => {
    const hay = fold(`${p.name} ${p.brand || ""} ${p.barcode || ""} ${aliasCodes(p.id).join(" ")} ${p.createdByName || ""}`);
    return words.every((w) => hay.includes(w)); // все слова запроса должны встретиться: «куриная жарен»
  });
}

function productRow(p, attr) {
  const mine = !!state.user && p.createdBy === state.user.uid;
  const by = !mine && p.createdByName ? `Добавил(а): ${esc(p.createdByName)}` : "";
  const meta = [p.brand ? esc(p.brand) : "", p.barcode ? esc(p.barcode) : "", by].filter(Boolean).join(", ");
  const hue = parseInt(fnv(fold(p.name)), 36) % 360, ch = (String(p.name || "?").trim()[0] || "?").toUpperCase();
  return `<button type="button" class="prow" ${attr}="${esc(p.id)}">
    <span class="p-ava" style="background:hsl(${hue} 55% 92%);color:hsl(${hue} 45% 30%)">${esc(ch)}</span>
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

// Напитки из дневника, чьих карточек больше нет ни в продуктах, ни в списке напитков (например, потерянные при переносе)
function lostDrinks() {
  const have = new Set(state.products.map((p) => p.id));
  const names = new Set(customList().map((d) => fold(d.n)));
  const by = new Map();
  for (const e of state.entries) {
    const id = e.productId;
    if (!id || String(id).startsWith("drink:") || have.has(id) || !e.drink || !e.per100 || !e.name) continue;
    const prev = by.get(id);
    if (!prev || String(e.date) > String(prev.date)) by.set(id, e);
  }
  const out = [], seen = new Set();
  for (const [id, e] of by) {
    const key = fold(e.name);
    if (names.has(key) || seen.has(key)) continue;
    seen.add(key);
    const pct = Number(e.drink.pct) || 0, caf = Number(e.drink.caf100) || 0, p = e.per100;
    const alc = pct < 0;
    const m = /^bc_(\d+)$/.exec(id);
    out.push({ id: "u" + Date.now().toString(36) + out.length, n: e.name, h: pct, c: Math.round(caf * 2.4 * 10) / 10, cat: alc ? "alc" : "other", a: alc ? (pct <= -200 ? "Крепкий алкоголь" : "Средний алкоголь") : "",
      k: Number(p.kcal) || 0, p: Number(p.protein) || 0, f: Number(p.fat) || 0, cb: Number(p.carbs) || 0, bc: m ? [m[1]] : [] });
  }
  return out;
}

function viewProducts() {
  const missing = starterMissing().length;
  const lost = lostDrinks().length;
  return `
    ${pageHead("Общая база", "Продукты", `
      <button type="button" class="iconbtn" data-act="scanProduct" aria-label="Сканировать штрих-код">${SCAN_SVG}</button>
      <button type="button" class="round-btn" data-act="newProduct" aria-label="Новый продукт">+</button>`)}
    <input id="prod-search" class="input search" type="search" placeholder="Название, штрих-код или автор" value="${esc(state.prodSearch)}" autocomplete="off">
    <section class="card list-card"><div id="plist" class="plist">${productListHtml()}</div></section>
    <p class="foot-note">Продукты видят все пользователи. Править или удалять продукт может только тот, кто его добавил.</p>
    ${lost ? `<section class="card">
      <h2 class="h2">Напитки из дневника</h2>
      <p class="foot-note" style="margin:0 0 12px">В дневнике есть ${lost} напитков, которых нет ни в продуктах, ни в списке напитков. Можно вернуть их карточками напитков (название, калории, БЖУ, гидратация и кофеин берутся из записей дневника).</p>
      <button type="button" class="btn ghost full" data-act="restoreDrinks">Восстановить напитки</button>
    </section>` : ""}
    ${missing ? `<section class="card">
      <h2 class="h2">Базовые продукты</h2>
      <p class="foot-note" style="margin:0 0 12px">Овощи, мясо, рыба, яйца, крупы, молочные продукты и фрукты: ${missing} позиций со справочными значениями на 100 г. Многие есть в нескольких видах: сырой, варёный, запечённый, жареный, тушёный. У жареных и тушёных значения ориентировочные и уже включают типичное количество масла. После добавления их увидят все.</p>
      <button type="button" class="btn ghost full" data-act="importStarter">Добавить в общую базу</button>
    </section>` : ""}`;
}

/* ================= Отчёты ================= */
/* ================= Аналитика: период, итоги, выводы, анализ через Gemini ================= */
const REP_PRESETS = [7, 14, 30, 90, 365, 0]; // 0 = за всё время
const presetLabel = (v) => (v === 0 ? "Всё" : v === 365 ? "Год" : `${v} дн.`);
const isSoupName = (n) => /суп|борщ|щи\b|бульон|солянк|харчо|окрошк|\bуха\b|рассольник|лапш/i.test(String(n || ""));
const MEAL_NAME = Object.fromEntries(MEALS.map((m) => [m.id, m.name]));

function reportDays() {
  const today = todayStr();
  const span = (from, to) => {
    const out = [];
    let d = from;
    while (d <= to && out.length < 5000) { out.push(d); d = addDays(d, 1); }
    return out.length ? out : [today];
  };
  if (state.repCustom) return span(state.repCustom.from, state.repCustom.to);
  if (state.repDays === 0) return span(earliestDate(), today);
  return span(addDays(today, -(state.repDays - 1)), today);
}
const shortDate = (s) => { const d = parseD(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`; };
const periodText = (days) => (days.length === 1 ? dayLabel(days[0]) : `${shortDate(days[0])} — ${shortDate(days[days.length - 1])}`);

// Все показатели за период считаются один раз
function analyze(days) {
  const plan = currentPlan();
  const goal = state.goal;
  const byDay = {};
  state.entries.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const per = days.map((d) => {
    const list = byDay[d] || [];
    const t = sumEntries(list);
    const items = fluidItems(d);
    const drinkKcal = list.filter((e) => e.drink).reduce((s, e) => s + (e.kcal || 0), 0);
    return {
      d, has: list.length > 0, list, ...t, drinkKcal,
      water: waterOn(d), hyd: hydrationOn(d), target: waterTarget(d), caf: caffeineOn(d),
      actMin: actMinutes(d), burned: actBurned(d), items,
      steps: stepsOn(d), hrAvg: Number((healthOn(d) || {}).hrAvg) || 0, restHr: Number((healthOn(d) || {}).restingHr) || 0,
      sleep: sleepHours(d), sleepDeep: Number((sleepOn(d) || {}).sleepDeepH) || 0, sleepRem: Number((sleepOn(d) || {}).sleepRemH) || 0, bed: bedMin((sleepOn(d) || {}).sleepStart),
    };
  });
  const logged = per.filter((x) => x.has);
  const L = logged.length;
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const avg = (f) => (L ? sum(logged, f) / L : 0);
  const kcalAvg = avg((x) => x.kcal), pAvg = avg((x) => x.protein), fAvg = avg((x) => x.fat), cAvg = avg((x) => x.carbs);
  const macroKcal = pAvg * 4 + fAvg * 9 + cAvg * 4 || 1;
  const share = { protein: (pAvg * 4) / macroKcal, fat: (fAvg * 9) / macroKcal, carbs: (cAvg * 4) / macroKcal };

  const mealKcal = {};
  MEALS.forEach((m) => { mealKcal[m.id] = 0; });
  logged.forEach((x) => x.list.forEach((e) => { mealKcal[e.meal] = (mealKcal[e.meal] || 0) + (e.kcal || 0); }));
  const mealTotal = sum(Object.values(mealKcal), (v) => v) || 1;

  const wd = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
  logged.forEach((x) => { const i = (parseD(x.d).getDay() + 6) % 7; wd[i].s += x.kcal; wd[i].n++; });

  const foods = {};
  logged.forEach((x) => x.list.forEach((e) => {
    if (e.drink && !isSoupName(e.name)) return; // напитки с калориями показываются только в «Что я пью»
    const f = foods[e.name] = foods[e.name] || { name: e.name, n: 0, kcal: 0, qty: 0, drink: !!e.drink };
    f.n++; f.kcal += e.kcal || 0; f.qty += e.grams || 0;
  }));
  const topFoods = Object.values(foods).sort((a, b) => b.kcal - a.kcal).slice(0, 8);

  const drinks = {};
  let plainWater = 0, alcMl = 0, cafTotal = 0, drinkKcalTotal = 0;
  per.forEach((x) => {
    plainWater += x.water;
    drinkKcalTotal += x.drinkKcal;
    x.items.forEach((i) => {
      if (i.kind === "drink" && isWaterDrink(i)) { plainWater += i.ml; return; }
      if (i.kind === "food" && isSoupName(i.name)) { cafTotal += itemCaf(i); return; } // супы в «Что я ем»
      const r = drinks[i.name] = drinks[i.name] || { name: i.name, n: 0, ml: 0, eff: 0, caf: 0, kcal: 0 };
      r.n++; r.ml += i.ml; r.eff += itemHyd(i); r.caf += itemCaf(i);
      if (i.kind === "food") r.kcal += i.kcal || 0;
      if (i.pct < 0) alcMl += i.ml;
      cafTotal += itemCaf(i);
    });
  });
  const drinkList = Object.values(drinks).sort((a, b) => b.ml - a.ml);
  const hydDays = per.filter((x) => x.hyd > 0);
  const hydAvg = hydDays.length ? sum(hydDays, (x) => x.hyd) / hydDays.length : 0;
  const targetAvg = per.length ? sum(per, (x) => x.target) / per.length : 0;
  const normDays = per.filter((x) => x.hyd >= x.target * 0.9).length;
  const cafDays = per.filter((x) => x.caf > 0);
  const cafLim = cafLimit();
  const cafOver = per.filter((x) => x.caf > cafLim).length;

  const actDays = per.filter((x) => x.actMin > 0);
  const actTotalMin = sum(per, (x) => x.actMin), actTotalKcal = sum(per, (x) => x.burned);
  const weeks = Math.max(1, per.length / 7);
  const stepDays = per.filter((x) => x.steps > 0), hrDays = per.filter((x) => x.hrAvg > 0), restDays = per.filter((x) => x.restHr > 0);
  const stepsAvg = stepDays.length ? sum(stepDays, (x) => x.steps) / stepDays.length : 0;
  const hrAvgAll = hrDays.length ? sum(hrDays, (x) => x.hrAvg) / hrDays.length : 0;
  const restAvg = restDays.length ? sum(restDays, (x) => x.restHr) / restDays.length : 0;
  const sleepDays = per.filter((x) => x.sleep > 0);
  const sleepAvg = sleepDays.length ? sum(sleepDays, (x) => x.sleep) / sleepDays.length : 0;
  const deepDays = sleepDays.filter((x) => x.sleepDeep > 0), remDays = sleepDays.filter((x) => x.sleepRem > 0), bedDays = sleepDays.filter((x) => x.bed != null);
  const sleepDeepAvg = deepDays.length ? sum(deepDays, (x) => x.sleepDeep) / deepDays.length : 0;
  const sleepRemAvg = remDays.length ? sum(remDays, (x) => x.sleepRem) / remDays.length : 0;
  const sleepShort = sleepDays.filter((x) => x.sleep < SLEEP_MIN).length;
  const bedAvg = bedDays.length ? sum(bedDays, (x) => x.bed) / bedDays.length : 0;
  const bedSd = bedDays.length > 1 ? Math.sqrt(sum(bedDays, (x) => (x.bed - bedAvg) ** 2) / bedDays.length) : 0;
  const wkInRange = state.workouts.filter((w) => w.date >= days[0] && w.date <= days[days.length - 1]);
  const types = {};
  state.activity.filter((a) => a.date >= days[0] && a.date <= days[days.length - 1]).forEach((a) => {
    const t = types[a.name || a.type] = types[a.name || a.type] || { name: a.name || a.type, n: 0, min: 0, kcal: 0, strength: a.type === "strength" };
    t.n++; t.min += Number(a.minutes) || 0; t.kcal += Number(a.kcal) || 0;
  });
  wkInRange.forEach((w) => {
    const t = types[w.name] = types[w.name] || { name: w.name, n: 0, min: 0, kcal: 0, strength: false };
    t.n++; t.min += Number(w.minutes) || 0; t.kcal += Number(w.kcal) || 0;
  });
  const actTypes = Object.values(types).sort((a, b) => b.min - a.min);
  const strengthSessions = actTypes.filter((t) => t.strength).reduce((s, t) => s + t.n, 0) + wkInRange.filter(isStrengthW).length;

  const overDays = logged.filter((x) => x.kcal > goal * 1.1).length;
  const underDays = logged.filter((x) => x.kcal < goal * 0.7).length;
  return {
    days, per, logged, L, plan, goal, kcalAvg, pAvg, fAvg, cAvg, share, mealKcal, mealTotal, wd, topFoods,
    drinkList, plainWater, alcMl, cafTotal, drinkKcalTotal, hydAvg, hydDays: hydDays.length, targetAvg, normDays,
    cafAvg: cafDays.length ? cafTotal / cafDays.length : 0, cafDays: cafDays.length, cafLim, cafOver,
    actDays: actDays.length, actTotalMin, actTotalKcal, weeks, actTypes, strengthSessions, overDays, underDays,
    burnedAvg: per.length ? actTotalKcal / per.length : 0,
    stepDays: stepDays.length, stepsAvg, hrAvgAll, restAvg, workoutCount: wkInRange.length,
    sleepDays: sleepDays.length, sleepAvg, sleepDeepAvg, sleepRemAvg, sleepShort, bedAvg, bedN: bedDays.length, bedSd,
  };
}

// Выводы без ИИ: простые правила по данным периода
function localInsights(a) {
  const out = [];
  const n = a.days.length;
  const add = (kind, text) => out.push({ kind, text });
  if (a.L === 0) { add("info", "За выбранный период нет записей о еде. Ведите дневник хотя бы несколько дней, и здесь появятся выводы."); return out; }
  if (a.L < n * 0.7) add("info", `Еда записана в ${a.L} днях из ${n}. Чем полнее дневник, тем точнее выводы: пропущенные дни не учитываются.`);
  const dev = (a.kcalAvg - a.goal) / a.goal;
  if (Math.abs(dev) <= 0.1) add("good", `Калории в среднем ${fmtInt(a.kcalAvg)} ккал в день: это в пределах 10% от вашей цели (${fmtInt(a.goal)}).`);
  else if (dev > 0) add(dev > 0.2 ? "bad" : "warn", `В среднем вы едите ${fmtInt(a.kcalAvg)} ккал в день, это на ${fmtInt(a.kcalAvg - a.goal)} больше цели (${fmtInt(a.goal)}). Дней с перебором более 10%: ${a.overDays}.`);
  else add("info", `В среднем ${fmtInt(a.kcalAvg)} ккал в день, это на ${fmtInt(a.goal - a.kcalAvg)} меньше цели. Дней, когда съедено меньше 70% цели: ${a.underDays}.`);
  if (a.plan) {
    const pr = a.pAvg / a.plan.protein;
    if (pr < 0.85) add(pr < 0.7 ? "bad" : "warn", `Белка мало: в среднем ${fmt(a.pAvg)} г при ориентире ${a.plan.protein} г. Белок помогает сохранять мышцы и дольше держит сытость.`);
    else add("good", `Белок в норме: ${fmt(a.pAvg)} г в день при ориентире ${a.plan.protein} г.`);
  }
  const pct = (v) => Math.round(v * 100);
  add("info", `Структура калорий: белки ${pct(a.share.protein)}%, жиры ${pct(a.share.fat)}%, углеводы ${pct(a.share.carbs)}%.`);
  if (a.share.fat > 0.38) add(a.share.fat > 0.45 ? "bad" : "warn", `Жиров много: ${pct(a.share.fat)}% калорий. Обычный ориентир до 30–35%.`);
  const meals = MEALS.map((m) => ({ m, s: a.mealKcal[m.id] / a.mealTotal })).sort((x, y) => y.s - x.s);
  if (meals[0].s > 0.45) add("info", `Больше всего калорий приходится на «${meals[0].m.name.toLowerCase()}»: ${pct(meals[0].s)}%.`);
  const snack = a.mealKcal.snack / a.mealTotal;
  if (snack > 0.3) add(snack > 0.4 ? "bad" : "warn", `Перекусы дают ${pct(snack)}% калорий. Проверьте, не уходят ли туда сладкое и напитки.`);
  const wdAvg = a.wd.map((x) => (x.n ? x.s / x.n : 0));
  const withWd = wdAvg.map((v, i) => ({ v, i })).filter((x) => a.wd[x.i].n >= 2);
  if (withWd.length >= 4) {
    const hi = withWd.reduce((p, c) => (c.v > p.v ? c : p)), lo = withWd.reduce((p, c) => (c.v < p.v ? c : p));
    if (hi.v > lo.v * 1.25) add("info", `Дни недели различаются: больше всего вы едите в ${["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"][hi.i]} (${fmtInt(hi.v)} ккал), меньше всего в ${["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"][lo.i]} (${fmtInt(lo.v)}).`);
  }
  if (a.hydDays) {
    const r = a.hydAvg / a.targetAvg;
    if (r < 0.8) add(r < 0.65 ? "bad" : "warn", `Жидкости не хватает: в среднем ${fmtInt(a.hydAvg)} мл при норме около ${fmtInt(a.targetAvg)} мл. Норма выполнена в ${a.normDays} днях из ${a.days.length}.`);
    else add("good", `Жидкость в порядке: в среднем ${fmtInt(a.hydAvg)} мл при норме около ${fmtInt(a.targetAvg)} мл. Норма выполнена в ${a.normDays} днях из ${a.days.length}.`);
  } else add("info", "Жидкость не записывалась. Добавляйте воду и напитки, чтобы видеть баланс.");
  if (a.drinkKcalTotal > 0 && a.L) {
    const dk = a.drinkKcalTotal / a.L;
    if (dk > a.kcalAvg * 0.1) add(dk > a.kcalAvg * 0.2 ? "bad" : "warn", `С напитками вы получаете в среднем ${fmtInt(dk)} ккал в день (${pct(dk / a.kcalAvg)}% рациона). Это легко сократить.`);
    else add("info", `Калории из напитков: в среднем ${fmtInt(dk)} ккал в день.`);
  }
  if (a.alcMl > 0) add("warn", `За период записан алкоголь: ${fmtInt(a.alcMl)} мл. Он обезвоживает и добавляет калории.`);
  if (a.cafTotal > 0) {
    if (a.cafOver) add(a.cafOver >= a.days.length * 0.3 ? "bad" : "warn", `Кофеина больше нормы (${a.cafLim} мг) в ${a.cafOver} днях. В среднем ${fmtInt(a.cafAvg)} мг в день с кофеином.`);
    else add("good", `Кофеин в пределах нормы: в среднем ${fmtInt(a.cafAvg)} мг в день при допустимых ${a.cafLim} мг.`);
  }
  if (a.actTotalMin === 0) add("bad", "Нагрузок за период нет. Даже ежедневная быстрая ходьба 20–30 минут заметно меняет самочувствие и расход калорий.");
  else {
    const perWeek = a.actTotalMin / a.weeks;
    const t = a.plan ? a.plan.weekly : null;
    if (t) add(perWeek >= t.minutes ? "good" : perWeek < t.minutes * 0.5 ? "bad" : "warn", `Нагрузка: ${fmtInt(perWeek)} мин в неделю при ориентире ${t.minutes} мин. Активных дней: ${a.actDays} из ${a.days.length}.`);
    else add("info", `Нагрузка: ${fmtInt(perWeek)} мин в неделю, активных дней ${a.actDays} из ${a.days.length}.`);
    if (a.stepDays) add(a.stepsAvg >= STEPS_GOAL ? "good" : "info", `Шагов в среднем ${fmtInt(a.stepsAvg)} в день (дней с данными ${a.stepDays}). Ориентир для здоровья: около ${fmtInt(STEPS_GOAL)} шагов.`);
    if (t) {
      const sw = a.strengthSessions / a.weeks;
      if (sw < t.strength * 0.7) add("info", `Силовых тренировок ${fmt(sw)} в неделю при ориентире ${t.strength}.`);
    }
  }
  const rank = { bad: 0, warn: 1, good: 2, info: 3 };
  if (!a.sleepDays) add("info", "Сон: данных пока нет. Он приходит с Apple Watch через Health Auto Export (метрика «Sleep Analysis», Aggregated). Как только ночи появятся, они войдут в выводы, графики и анализ ИИ.");
  if (a.sleepDays) {
    const sa = a.sleepAvg, nn = a.sleepDays;
    if (sa < 6) add("bad", `Сна мало: в среднем ${fmtDur(sa)} за ночь (ночей с данными ${nn}). Ориентир для взрослых ${SLEEP_MIN}–${SLEEP_MAX} часов.`);
    else if (sa < SLEEP_MIN) add("warn", `Сна немного не хватает: в среднем ${fmtDur(sa)} за ночь. Ориентир ${SLEEP_MIN}–${SLEEP_MAX} часов.`);
    else if (sa <= SLEEP_MAX) add("good", `Сон в норме: в среднем ${fmtDur(sa)} за ночь при ориентире ${SLEEP_MIN}–${SLEEP_MAX} часов.`);
    else add("info", `Сна много: в среднем ${fmtDur(sa)} за ночь. Если при этом нет бодрости, обсудите это с врачом.`);
    if (sa >= SLEEP_MIN && a.sleepShort >= Math.max(2, nn * 0.3)) add("warn", `Ночей короче ${SLEEP_MIN} часов: ${a.sleepShort} из ${nn}. Недосып копится, даже если среднее в норме.`);
    if (a.sleepDeepAvg > 0 && sa > 0) {
      const dp = a.sleepDeepAvg / sa;
      if (dp < 0.1) add("warn", `Глубокого сна мало: ${pct(dp)}% ночи (${fmtDur(a.sleepDeepAvg)}). Обычно 13–23%. Помогают режим, прохладная комната и меньше кофеина и алкоголя вечером.`);
      else add("info", `Глубокий сон: ${fmtDur(a.sleepDeepAvg)} за ночь (${pct(dp)}%)${a.sleepRemAvg > 0 ? `, фаза REM ${fmtDur(a.sleepRemAvg)} (${pct(a.sleepRemAvg / sa)}%)` : ""}.`);
    }
    if (a.bedN >= 4 && a.bedSd > 60) add("warn", `Время отхода ко сну плавает: в среднем ${minToClock(a.bedAvg)}, разброс около ${fmtInt(a.bedSd)} мин. Регулярный режим улучшает качество сна.`);
    else if (a.bedN >= 2) add("info", `Обычно вы засыпаете около ${minToClock(a.bedAvg)}.`);
  }
  const tp = trainPlanData(a.days[0], a.days[a.days.length - 1]);
  if (tp && tp.st.planned) {
    const sk = tp.st.list.filter((e) => e.plan >= 2 && e.done / e.plan <= 0.5).slice(0, 3).map((e) => e.name.toLowerCase());
    add(tp.pct >= 80 ? "good" : tp.pct >= 50 ? "warn" : "bad", `План тренировок: выполнено ${tp.st.plannedDone} из ${tp.st.planned} упражнений (${tp.pct}%), завершено тренировок ${tp.st.daysDone} из ${tp.st.days}.${sk.length ? ` Чаще пропускаете: ${sk.join(", ")}.` : ""}`);
  }
  if (tp && tp.feels.length >= 2) {
    const r = Math.round(tp.avg);
    add(r <= 2 ? "info" : r >= 4 ? "warn" : "good", `Тяжесть тренировок по плану в среднем «${feelLabel(r).toLowerCase()}» (${fmt(Math.round(tp.avg * 10) / 10)} из 5).${r <= 2 ? " Можно брать резинку потяжелее." : r >= 4 ? " Нагрузка тяжёлая: не повышайте вес и следите за восстановлением." : ""}`);
  }
  return out.map((x, i) => ({ ...x, i })).sort((x, y) => rank[x.kind] - rank[y.kind] || x.i - y.i);
}

// ---- Gemini ----
const AI_KEY = "gemini_api_key";
const geminiKey = () => (lsGet(AI_KEY) || "").trim();
const AI_BASE = "https://generativelanguage.googleapis.com/v1beta";
let aiModelsCache = null;

async function fetchT(url, opts = {}, ms = 40000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function geminiModels(key) {
  if (aiModelsCache) return aiModelsCache;
  const r = await fetchT(`${AI_BASE}/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, 20000);
  if (!r.ok) throw await geminiError(r);
  const j = await r.json();
  const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
  const list = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name)
    .filter((n) => /gemini-[\d.]+-flash/.test(n) && !/image|live|tts|audio|thinking|exp|robotics|computer|embedding|learnlm|customtools/.test(n));
  // сначала обычные стабильные (новее выше), затем preview, в самом конце облегчённые lite: они реже перегружены
  const rank = (n) => (/lite/.test(n) ? 2 : /preview/.test(n) ? 1 : 0);
  list.sort((a, b) => (rank(a) - rank(b)) || (ver(b) - ver(a)) || a.length - b.length);
  aiModelsCache = list.length ? list.slice(0, 5) : ["models/gemini-flash-latest"];
  return aiModelsCache;
}
async function geminiError(r) {
  let msg = "";
  try { const j = await r.json(); msg = (j.error && j.error.message) || ""; } catch { /* ignore */ }
  const e = new Error(msg || `Ошибка ${r.status}`);
  e.status = r.status;
  return e;
}
// Запрос к Gemini. Быстрее за счёт: запомненной рабочей модели (пробуется первой, без запроса списка),
// короткого таймаута на попытку, отключённых «размышлений» и потокового ответа (extra.onText).
async function askGemini(prompt, step = () => {}, extra = {}) {
  const key = geminiKey();
  if (!key) throw new Error("no-key");
  const prefKey = extra.lite ? "gm_lite" : "gm_std";
  const pref = lsGet(prefKey) || "";
  const TIMEOUT = extra.image ? 25000 : 20000;
  let last = null, real = null, noThink = true, models = null;
  const body = () => JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, ...(extra.image ? [{ inlineData: { mimeType: extra.image.mime, data: extra.image.data } }] : [])] }],
    generationConfig: { temperature: extra.json ? 0.2 : 0.4, maxOutputTokens: 8192, ...(extra.json ? { responseMimeType: "application/json" } : {}), ...(noThink ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  const textOf = (j) => (((j.candidates || [])[0] || {}).content || {}).parts ? ((j.candidates[0].content.parts) || []).map((p) => p.text || "").join("") : "";

  async function once(model) {
    if (!extra.onText) {
      const r = await fetchT(`${AI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body() }, TIMEOUT);
      if (!r.ok) throw await geminiError(r);
      const j = await r.json();
      const text = textOf(j).trim();
      if (!text) throw new Error((j.promptFeedback && j.promptFeedback.blockReason) ? `Запрос отклонён: ${j.promptFeedback.blockReason}` : "Пустой ответ");
      return text;
    }
    // потоковый ответ: текст появляется сразу; таймаут действует до первых данных
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${AI_BASE}/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(), signal: ctl.signal });
      if (!r.ok) throw await geminiError(r);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "", text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 30000); // пауза между кусками
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            try { const t = textOf(JSON.parse(line.slice(5))); if (t) { text += t; extra.onText(text); } } catch { /* неполный кусок */ }
          }
        }
        if (done) break;
      }
      text = text.trim();
      if (!text) throw new Error("Пустой ответ");
      return text;
    } finally { clearTimeout(timer); }
  }

  const order = async () => {
    if (!models) {
      step("Подбираю модель Gemini…");
      models = await geminiModels(key);
      if (extra.lite) { const lt = models.filter((m) => /lite/.test(m)); models = [...lt, ...models.filter((m) => !lt.includes(m))]; }
    }
    return models;
  };
  const tried = new Set();
  const queue = pref ? [pref] : [];
  let fatal = false;
  // Google иногда перегружен сразу по всем моделям (503): делаем до 4 кругов с паузой, во втором и дальше сначала лёгкие модели
  for (let round = 0; round < 4 && !fatal; round++) {
  if (round > 0) {
    const wait = 4 * round;
    step(`Gemini перегружен (это на стороне Google). Повтор через ${wait} с, круг ${round + 1} из 4…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    tried.clear(); queue.length = 0;
    if (models) { const lt = models.filter((m) => /lite/.test(m)); models = [...lt, ...models.filter((m) => !lt.includes(m))]; }
  }
  for (let n = 0; n < 6; n++) {
    let model = queue.shift();
    if (!model) {
      const list = (await order()).filter((m) => !tried.has(m));
      if (!list.length) break;
      model = list[0];
    }
    if (tried.has(model)) continue;
    tried.add(model);
    step(`Запрос к ${model.replace("models/", "")}…${last ? ` Прошлая попытка: ${String((real || last).message || last).slice(0, 120)}` : ""}`);
    try {
      const text = await once(model);
      lsSet(prefKey, model);
      return { text, model: model.replace("models/", "") };
    } catch (e0) {
      // у DOMException (обрыв по таймауту) message только для чтения: заменяем обычной ошибкой
      const e = e0 && e0.name === "AbortError" ? Object.assign(new Error("нет ответа вовремя"), { name: "AbortError" }) : e0;
      last = e;
      if (e.status !== 404) real = e;
      if (noThink && e.status === 400 && /think/i.test(e.message || "")) { noThink = false; tried.delete(model); queue.unshift(model); continue; }
      if (e.status === 404 && model === pref) lsSet(prefKey, ""); // запомненная модель исчезла
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 429) { fatal = true; break; } // ключ или лимит: другая модель не поможет
      if (extra.onText) extra.onText(""); // сброс частичного текста перед следующей моделью
    }
  }
  if (fatal || !real) break; // не перегрузка: повторять бесполезно
  }
  aiModelsCache = null;
  throw real || last || new Error("Не удалось получить ответ");
}

function aiPayload(a) {
  const pr = state.profile, plan = a.plan;
  const r = (x) => Math.round(x);
  return {
    период: { с: a.days[0], по: a.days[a.days.length - 1], дней: a.days.length, дней_с_записями_еды: a.L },
    профиль: pr && plan ? { пол: pr.sex === "male" ? "мужской" : "женский", возраст: pr.age, рост_см: pr.heightCm, вес_кг: pr.weightKg, цель: GOAL_NAME[pr.goal], ИМТ: plan.bmi } : "не заполнен",
    план: plan ? { ккал: plan.kcal, белки_г: plan.protein, жиры_г: plan.fat, углеводы_г: plan.carbs, вода_мл: plan.water, нагрузка_мин_в_неделю: plan.weekly.minutes, силовых_в_неделю: plan.weekly.strength } : { ккал: a.goal },
    среднее_за_день_с_записями: { ккал: r(a.kcalAvg), белки_г: r(a.pAvg), жиры_г: r(a.fAvg), углеводы_г: r(a.cAvg), доли_калорий_БЖУ_проц: [Math.round(a.share.protein * 100), Math.round(a.share.fat * 100), Math.round(a.share.carbs * 100)] },
    дней_с_перебором_более_10проц: a.overDays, дней_менее_70проц_цели: a.underDays,
    калории_по_приёмам_проц: Object.fromEntries(MEALS.map((m) => [m.name, Math.round((a.mealKcal[m.id] / a.mealTotal) * 100)])),
    ккал_по_дням_недели: Object.fromEntries(WD_WEEK.map((n, i) => [n, a.wd[i].n ? r(a.wd[i].s / a.wd[i].n) : null])),
    чаще_всего_в_рационе: a.topFoods.map((f) => ({ продукт: f.name, раз: f.n, ккал_всего: r(f.kcal) })),
    жидкость: {
      среднее_засчитанное_мл_в_день: r(a.hydAvg), средняя_норма_мл: r(a.targetAvg), дней_норма_выполнена: a.normDays,
      чистая_вода_мл_всего: r(a.plainWater), алкоголь_мл_всего: r(a.alcMl), ккал_из_напитков_всего: r(a.drinkKcalTotal),
      напитки: a.drinkList.slice(0, 12).map((d) => ({ напиток: d.name, раз: d.n, мл: r(d.ml), кофеин_мг: r(d.caf) })),
    },
    кофеин: { среднее_мг_в_день_с_кофеином: r(a.cafAvg), допустимо_мг_в_день: a.cafLim, дней_выше_нормы: a.cafOver },
    нагрузка: {
      силовых_тренировок: a.strengthSessions, минут_всего: a.actTotalMin, активных_дней: a.actDays, минут_в_неделю: r(a.actTotalMin / a.weeks), сожжено_ккал_всего: r(a.actTotalKcal),
      виды: a.actTypes.map((t) => ({ вид: t.name, раз: t.n, мин: t.min, ккал: t.kcal })),
    },
    тренировки_по_плану_приложения: (() => {
      const t = trainPlanData(a.days[0], a.days[a.days.length - 1]);
      if (!t) return "план тренировок в этом периоде не вёлся";
      const cfg = trainCfg();
      return {
        примечание: "Это личный план домашних тренировок из приложения, он НЕ связан с данными Apple Health и не входит в блок нагрузка",
        место: TR.PLACES.find((p) => p.v === cfg.place).t, дни_недели: cfg.days.map((d) => TR.DAY_SHORT[d]), уровень: (TR.TRAIN_LEVELS.find((l) => l.v === cfg.level) || {}).t,
        запланировано_тренировок: t.st.days, завершено_тренировок: t.st.daysDone, упражнений_запланировано: t.st.planned, упражнений_выполнено: t.st.plannedDone, выполнено_проц: t.pct,
        серия_без_пропусков: t.st.streak,
        тяжесть_по_оценке_1_легко_5_тяжело: t.feels.length ? { средняя: Math.round(t.avg * 10) / 10, оценки_по_тренировкам: t.logs.filter((l) => l.feel).map((l) => [l.date.slice(5), Number(l.feel)]) } : "оценок нет",
        резинки_и_инвентарь: t.logs.map((l) => [l.date.slice(5), bandsText(l) || null, (l.used || []).length ? l.used.map((id) => (TR.EQUIP.find((e) => e.id === id) || {}).t).filter(Boolean).join(", ") : null]).filter((x) => x[1] || x[2]).slice(-12),
        упражнения: t.st.list.map((e) => ({ упражнение: e.name, группа_мышц: TR.MG[e.mg] || null, выполнено: e.done, запланировано: e.plan })),
      };
    })(),
    данные_с_часов_Apple_Health: a.stepDays || a.hrAvgAll || a.workoutCount ? {
      шагов_в_день_среднее: r(a.stepsAvg), дней_с_данными_о_шагах: a.stepDays,
      средний_пульс_уд_мин: r(a.hrAvgAll), пульс_покоя_уд_мин: r(a.restAvg), тренировок_записано_часами: a.workoutCount,
    } : "нет данных с часов",
    сон: a.sleepDays ? {
      ночей_с_данными: a.sleepDays, среднее_часов_сна: r(a.sleepAvg), ночей_короче_7_часов: a.sleepShort,
      глубокий_сон_в_среднем_ч: r(a.sleepDeepAvg), REM_в_среднем_ч: r(a.sleepRemAvg),
      среднее_время_засыпания: a.bedN ? minToClock(a.bedAvg) : null, разброс_времени_засыпания_мин: a.bedN > 1 ? Math.round(a.bedSd) : null,
    } : "данные о сне в этом периоде не поступили (интеграция с Apple Watch для сна предусмотрена, но ночей пока нет)",
    ...(a.days.length > 120
      ? {
        по_неделям: Array.from({ length: Math.ceil(a.per.length / 7) }, (_, w) => {
          const seg = a.per.slice(w * 7, w * 7 + 7), lg = seg.filter((x) => x.has), hy = seg.filter((x) => x.hyd > 0);
          const av = (arr, f) => (arr.length ? r(arr.reduce((t, x) => t + f(x), 0) / arr.length) : null);
          return [seg[0].d, av(lg, (x) => x.kcal), av(lg, (x) => x.protein), av(hy, (x) => x.hyd), r(seg.reduce((t, x) => t + x.caf, 0) / seg.length), seg.reduce((t, x) => t + x.actMin, 0), av(seg.filter((x) => x.steps > 0), (x) => x.steps)];
        }),
        формат_по_неделям: "[дата начала недели, среднее ккал за дни с записями, средние белки г, средняя жидкость мл, средний кофеин мг в день, нагрузка мин за неделю, средние шаги в день]; null значит записей нет",
      }
      : {
        по_дням: a.per.map((x) => [x.d.slice(5), x.has ? r(x.kcal) : null, x.has ? r(x.protein) : null, x.hyd ? r(x.hyd) : null, r(x.caf), x.actMin, x.steps ? r(x.steps) : null, x.hrAvg ? r(x.hrAvg) : null, x.sleep ? r(x.sleep) : null]),
        формат_по_дням: "[дата ММ-ДД, ккал, белки г, жидкость мл, кофеин мг, нагрузка мин, шаги, средний пульс, сон часов]; null значит записей нет",
      }),
  };
}
function aiPrompt(a) {
  return `Ты внимательный аналитик питания и образа жизни. Ниже данные из личного дневника здоровья пользователя за период. Напиши по-русски понятные, конкретные выводы: что и как он ест, сколько и что пьёт, сколько кофеина, какая у него нагрузка, как он спит и как это соотносится с целью.

Требования:
- Опирайся только на данные ниже, называй конкретные числа. Если записей мало или есть пропущенные дни, прямо скажи, что выводы приблизительные.
- Не ставь диагнозы и не назначай лечение. Ты не заменяешь врача. Если в данных видно что-то тревожное (очень низкие калории, много алкоголя, кофеина выше нормы), мягко посоветуй обсудить это со специалистом.
- Пиши простым языком, без воды и без общих фраз про здоровый образ жизни.
- Формат: заголовки второго уровня («## Общая картина», «## Питание», «## Жидкость и напитки», «## Кофеин», «## Сон», «## Нагрузка», «## Упражнения дома», «## Что получается хорошо», «## На что обратить внимание», «## План на ближайшую неделю»). Внутри разделов короткие абзацы и списки через «- ». Таблицы не используй. «План на ближайшую неделю»: 3–5 конкретных, выполнимых шагов.
- Раздел «Кофеин» пропусти, если кофеина нет.
- Если данных о сне нет, в разделе «Сон» одной-двумя фразами скажи, что сон в этом периоде не поступил с часов (приложение умеет его принимать через Health Auto Export, метрика Sleep Analysis), и не выдумывай цифры. Если данные есть, оцени длительность (ориентир 7–9 часов), глубокий сон и REM, регулярность времени засыпания и свяжи сон с кофеином, алкоголем, нагрузкой и питанием, если это видно в данных. Не ставь диагнозы.
- В разделе «Нагрузка» учти шаги, пульс и тренировки с часов Apple Watch, если они есть в данных: оцени уровень активности по шагам и пульсу и скажи, как это согласуется с целью. Пульс покоя и средний пульс не трактуй как диагноз.
- Если в данных есть «тренировки_по_плану_приложения», в разделе «Нагрузка» отдельным абзацем оцени выполнение плана (процент, серия, какие упражнения и группы мышц пропускаются) и тяжесть (оценки 1–5, резинки и вес): скажи, пора ли усложнять или облегчать. Не смешивай эти данные с данными часов Apple Health: это разные источники.
- Раздел «Упражнения дома» обязателен: 4–6 конкретных упражнений без оборудования или с минимумом (стул, бутылки с водой, коврик) под цель пользователя, его вес, возраст и текущую нагрузку из данных. Для каждого: название, сколько подходов и повторений (или минут), сколько раз в неделю и короткая подсказка по технике. Если нагрузок в данных нет или мало, начни с лёгкого уровня и укажи, как постепенно усложнять. Учитывай питание: если калорий или белка заметно не хватает, предупреди, что интенсивность лучше повышать позже. Не предлагай экстремальных нагрузок и добавь, что при болях, травмах или хронических заболеваниях стоит посоветоваться с врачом.

Данные (JSON):
${JSON.stringify(aiPayload(a))}`;
}

// Итоговая оценка и взаимосвязи между показателями (локально, без ИИ)
function crossInsights(a) {
  const out = { verdict: null, links: [] };
  if (!a.L && !a.hydDays && !a.actTotalMin && !a.sleepDays) return out;
  const pct = (v) => Math.round(v * 100);
  const mean = (arr, f) => (arr.length ? arr.reduce((t, x) => t + f(x), 0) / arr.length : 0);
  // --- общая оценка: каждый показатель получает уровень good / warn / bad ---
  const m = [];
  if (a.L) {
    const dev = (a.kcalAvg - a.goal) / a.goal;
    m.push(["Калории", Math.abs(dev) <= 0.1 ? "good" : Math.abs(dev) <= 0.2 ? "warn" : "bad"]);
    if (a.plan) { const pr = a.pAvg / a.plan.protein; m.push(["Белок", pr >= 0.85 ? "good" : pr >= 0.7 ? "warn" : "bad"]); }
  }
  if (a.hydDays) { const r = a.hydAvg / a.targetAvg; m.push(["Жидкость", r >= 0.8 ? "good" : r >= 0.65 ? "warn" : "bad"]); }
  if (a.cafTotal > 0) m.push(["Кофеин", a.cafOver === 0 ? "good" : a.cafOver >= a.days.length * 0.3 ? "bad" : "warn"]);
  if (a.plan && a.plan.weekly) { const pw = a.actTotalMin / a.weeks, tt = a.plan.weekly.minutes; m.push(["Нагрузка", pw >= tt ? "good" : pw >= tt * 0.5 ? "warn" : "bad"]); }
  if (a.stepDays) m.push(["Шаги", a.stepsAvg >= STEPS_GOAL ? "good" : a.stepsAvg >= STEPS_GOAL * 0.6 ? "warn" : "bad"]);
  if (a.sleepDays) m.push(["Сон", a.sleepAvg >= SLEEP_MIN ? "good" : a.sleepAvg >= 6 ? "warn" : "bad"]);
  if (m.length >= 3) {
    const good = m.filter((x) => x[1] === "good"), bad = m.filter((x) => x[1] === "bad"), warn = m.filter((x) => x[1] === "warn");
    const share = good.length / m.length;
    let lv, head;
    if (bad.length === 0 && share >= 0.7) { lv = "good"; head = "Вы на хорошем уровне."; }
    else if (bad.length >= 2 || share < 0.4) { lv = "bad"; head = "Пока ниже нормы: есть над чем поработать."; }
    else { lv = "warn"; head = "В целом неплохо, но кое-что стоит подтянуть."; }
    const names = (arr) => arr.map((x) => x[0].toLowerCase()).join(", ");
    const tail = [good.length ? `в норме: ${names(good)}` : "", warn.length ? `можно лучше: ${names(warn)}` : "", bad.length ? `главное внимание: ${names(bad)}` : ""].filter(Boolean).join("; ");
    out.verdict = { lv, text: `${head} В норме ${good.length} из ${m.length} показателей (${tail}).${a.sleepDays ? "" : " Сон пока не учтён: нет данных."}` };
  }
  // --- взаимосвязи ---
  const add = (kind, text) => out.links.push({ kind, text });
  const per = a.per;
  if (!a.sleepDays) add("info", "Сон и остальные показатели: данных о сне пока нет, поэтому связи сна с едой, кофеином и нагрузкой не посчитаны. Они появятся сами, когда придут ночи с часов.");
  const actD = per.filter((x) => x.actMin > 0 && x.hyd > 0), restD = per.filter((x) => x.actMin === 0 && x.hyd > 0);
  if (actD.length >= 2 && restD.length >= 2) {
    const ra = mean(actD, (x) => x.hyd / x.target), rr = mean(restD, (x) => x.hyd / x.target);
    if (ra < rr - 0.1) add("warn", `Нагрузка и вода: в дни с тренировками вы пьёте ${pct(ra)}% нормы, в остальные ${pct(rr)}%. При нагрузке норма растёт, пейте воду до и после занятия.`);
    else if (ra >= 0.85) add("good", `Нагрузка и вода: в дни с тренировками воды хватает (${pct(ra)}% нормы).`);
    else add("info", `Нагрузка и вода: в дни с тренировками выпито ${pct(ra)}% нормы, в остальные ${pct(rr)}%.`);
  }
  if (a.actTotalKcal > 0 && a.L) {
    const net = a.kcalAvg - a.burnedAvg;
    add("info", `Нагрузка и калории: в среднем съедено ${fmtInt(a.kcalAvg)} ккал в день, нагрузка сжигает ещё ${fmtInt(a.burnedAvg)} ккал. С учётом нагрузки баланс ${fmtInt(net)} ккал в день при цели ${fmtInt(a.goal)} (расход на обмен веществ сюда не входит).`);
  }
  const eatAct = per.filter((x) => x.has && x.actMin > 0), eatRest = per.filter((x) => x.has && x.actMin === 0);
  if (eatAct.length >= 2 && eatRest.length >= 2) {
    const ka = mean(eatAct, (x) => x.kcal), kr = mean(eatRest, (x) => x.kcal);
    if (ka > kr * 1.15) add("info", `Нагрузка и аппетит: в дни с тренировками вы едите больше (${fmtInt(ka)} против ${fmtInt(kr)} ккал). Это нормально, главное, чтобы нагрузка не «съедалась» лишним.`);
  }
  if (a.plan && a.strengthSessions / a.weeks >= 1 && a.L && a.pAvg < a.plan.protein * 0.85) add("warn", `Силовые и белок: тренировки есть, а белка мало (${fmtInt(a.pAvg)} г при цели ${a.plan.protein} г). Мышцам не хватает материала для восстановления.`);
  if (a.sleepDays >= 4) {
    const shortD = per.filter((x) => x.has && x.sleep > 0 && x.sleep < SLEEP_MIN), longD = per.filter((x) => x.has && x.sleep >= SLEEP_MIN);
    if (shortD.length >= 2 && longD.length >= 2) {
      const ks = mean(shortD, (x) => x.kcal), kl = mean(longD, (x) => x.kcal);
      if (ks > kl * 1.1) add("warn", `Сон и еда: после коротких ночей вы едите больше (${fmtInt(ks)} против ${fmtInt(kl)} ккал). Недосып усиливает аппетит.`);
    }
    const prev = (i) => (i > 0 ? per[i - 1] : null);
    if (per.length <= 120) {
      const late = [], clean = [];
      per.forEach((x, i) => { const p = prev(i); if (!p || !(x.sleep > 0)) return; const hasLate = fluidItems(p.d).some((it) => itemCaf(it) > 0 && new Date(it.ts).getHours() >= 16); (hasLate ? late : clean).push(x.sleep); });
      if (late.length >= 2 && clean.length >= 2) {
        const sl = late.reduce((t, v) => t + v, 0) / late.length, sc = clean.reduce((t, v) => t + v, 0) / clean.length;
        if (sc - sl >= 0.4) add("warn", `Кофеин и сон: после дней с кофеином позже 16:00 вы спите на ${fmtInt((sc - sl) * 60)} мин меньше (${fmtDur(sl)} против ${fmtDur(sc)}).`);
        else add("info", `Кофеин и сон: заметной разницы после вечернего кофеина нет (${fmtDur(sl)} и ${fmtDur(sc)}).`);
      }
      const afterAct = [], afterRest = [];
      per.forEach((x, i) => { const p = prev(i); if (!p || !(x.sleep > 0)) return; (p.actMin > 0 ? afterAct : afterRest).push(x.sleep); });
      if (afterAct.length >= 2 && afterRest.length >= 2) {
        const sa = afterAct.reduce((t, v) => t + v, 0) / afterAct.length, sr = afterRest.reduce((t, v) => t + v, 0) / afterRest.length;
        if (sa - sr >= 0.3) add("good", `Нагрузка и сон: после дней с тренировками вы спите на ${fmtInt((sa - sr) * 60)} мин дольше.`);
        else if (sr - sa >= 0.3) add("info", `Нагрузка и сон: после дней с тренировками вы спите на ${fmtInt((sr - sa) * 60)} мин меньше. Возможно, занятия слишком поздно.`);
      }
    }
  }
  return out;
}

// Минимальный разбор разметки ответа: заголовки, списки, жирный текст
function mdLite(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  const out = [];
  let list = false;
  const closeList = () => { if (list) { out.push("</ul>"); list = false; } };
  String(text).split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    let m;
    if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = /^[-*•]\s+(.*)$/.exec(line))) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  });
  closeList();
  return out.join("");
}

// Последний ответ ИИ хранится до следующего запуска: на устройстве (localStorage) и в аккаунте (users/{uid}/settings/ai)
function aiLoadLocal() { try { const o = JSON.parse(lsGet("ai_last") || "null"); return o && o.text ? o : null; } catch { return null; } }
function aiSaveLast(rec) {
  lsSet("ai_last", JSON.stringify(rec));
  if (!state.user) return;
  setDoc(docRef("settings", "ai"), rec).catch((e) => { console.warn("Анализ не сохранился в базе:", e); toast("Анализ получен, но в аккаунт сохранить не удалось"); });
}

function aiCardHtml(days) {
  const key = geminiKey();
  const last = state.aiLast;
  const ai = state.ai;
  const stamp = (t) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const lastHtml = last
    ? `<div class="ai-text" style="margin-top:18px">${mdLite(last.text)}</div><p class="chart-note">Последний анализ: ${last.from && last.to ? `период ${esc(shortDate(last.from))} — ${esc(shortDate(last.to))}, ` : ""}получен ${esc(stamp(last.ts))}${last.model ? `, модель ${esc(last.model)}` : ""}. Хранится, пока вы не запустите новый. Это не медицинская рекомендация.</p>`
    : "";
  const delBtn = last ? `<button type="button" class="btn ghost full" style="margin-top:8px" data-act="aiDelete">Удалить анализ</button>` : "";
  const errHtml = ai.error ? `<div class="banner" role="alert"><b>${esc(ai.error)}</b>${ai.detail ? `<br><small style="white-space:pre-wrap;word-break:break-word">${esc(ai.detail)}</small>` : ""}</div>` : "";
  if (!key) {
    return `<section class="card ai-card ai-mini">
      <div class="ai-mini-row"><div><h2 class="h2">Анализ с помощью ИИ</h2><p class="foot-note" style="margin:4px 0 0">Gemini разберёт данные за период. Нужен бесплатный ключ.</p></div><button type="button" class="btn ghost sm" data-act="aiSetup">Подключить</button></div>
      ${delBtn}
      ${lastHtml}
    </section>`;
  }
  const status = ai.busy
    ? `<p class="foot-note" style="margin:0 0 12px">${esc(ai.step || "Gemini читает ваши данные. Обычно это 10–30 секунд.")}</p>`
    : errHtml || (last ? "" : `<p class="foot-note" style="margin:0 0 12px">Нажмите кнопку: ИИ изучит данные за период ${esc(periodText(days))} и напишет выводы. Сводка по дням без имени и почты отправляется в Google Gemini.</p>`);
  return `<section class="card ai-card ai-mini">
    <div class="ai-mini-row"><div><h2 class="h2">Анализ с помощью ИИ <span class="pill">Gemini</span></h2>${ai.busy || errHtml ? "" : last ? "" : `<p class="foot-note" style="margin:4px 0 0">ИИ изучит данные за ${esc(periodText(days))}. Сводка без имени и почты уходит в Google Gemini.</p>`}</div></div>
    ${ai.busy ? `<p class="foot-note" style="margin:8px 0 0">${esc(ai.step || "Gemini читает ваши данные. Обычно это 10–30 секунд.")}</p>` : errHtml}
    <div class="ai-actions"><button type="button" class="btn primary" id="ai-run" data-act="aiRun" ${ai.busy ? "disabled" : ""}>${ai.busy ? "Анализирую…" : last ? `Обновить за ${esc(periodText(days))}` : "Проанализировать"}</button><button type="button" class="btn ghost ai-key" data-act="aiForgetKey" aria-label="Сменить или удалить ключ" title="Ключ">🔑</button></div>
    ${delBtn}
    ${ai.busy && ai.partial ? `<div class="ai-text" style="margin-top:18px">${mdLite(ai.partial)}</div>` : lastHtml}
  </section>`;
}

function openAiSetup() {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Подключить Gemini</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="note">1. Откройте <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> и войдите в Google.<br>2. Нажмите «Create API key» и скопируйте ключ.<br>3. Вставьте его ниже.</div>
    <label class="field"><span>Ключ Gemini API</span><input id="ai-key" class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…"></label>
    <p class="foot-note" style="margin:0 2px 14px">Ключ хранится только на этом телефоне. Для анализа в Google Gemini отправляется сводка по дням за выбранный период (без имени и почты).</p>
    <button type="button" class="btn primary full" id="ai-save">Сохранить ключ</button>`);
  $("#ai-save", ov).addEventListener("click", () => {
    const v = $("#ai-key", ov).value.trim();
    if (!/^[\w.~-]{20,}$/.test(v)) { toast("Ключ выглядит неверно: скопируйте его целиком"); return; }
    try { localStorage.setItem(AI_KEY, v); } catch { toast("Не удалось сохранить ключ на этом устройстве"); return; }
    aiModelsCache = null;
    ov.close();
    toast("Ключ сохранён");
    render();
  });
}

// Состояние запуска хранится в state.ai, а не в разметке: перерисовка из-за обновления базы его не стирает
async function runAi() {
  if (state.ai.busy) return;
  const days = reportDays();
  const a = analyze(days);
  if (a.L === 0 && a.actTotalMin === 0 && a.hydAvg === 0) {
    state.ai = { busy: false, error: "За выбранный период нет данных для анализа.", detail: "Выберите другой период или запишите еду, воду или нагрузку." };
    render();
    return;
  }
  const step = (s) => { state.ai.step = s; if (state.tab === "reports") render(); };
  state.ai = { busy: true, error: "", detail: "", step: "Готовлю данные для Gemini…" };
  render();
  try {
    const r = await askGemini(aiPrompt(a), step, { onText: (t) => { state.ai.partial = t; if (state.tab === "reports") render(); } });
    const rec = { text: r.text, ts: Date.now(), model: r.model, from: days[0], to: days[days.length - 1] };
    state.aiLast = rec;
    aiSaveLast(rec);
    state.ai = { busy: false, error: "", detail: "" };
  } catch (e) {
    console.error("Gemini:", e);
    const m = String((e && e.message) || "");
    const s = e && e.status;
    const msg =
      s === 400 && /API key/i.test(m) ? "Ключ Gemini не подошёл. Проверьте его и вставьте заново."
        : s === 401 || s === 403 ? "Доступ запрещён: проверьте ключ Gemini."
          : s === 429 ? "Достигнут лимит запросов Gemini. Попробуйте позже."
            : (s === 503 || s === 500 || /high demand|overloaded|unavailable/i.test(m)) ? "Gemini сейчас перегружен (это на стороне Google). Подождите минуту и нажмите ещё раз."
              : (e && e.name === "AbortError") || /Failed to fetch|NetworkError|Load failed/i.test(m) ? "Нет связи с Gemini или он не ответил вовремя. Проверьте интернет и нажмите ещё раз."
                : "Не удалось получить анализ от Gemini.";
    // Прежний ответ остаётся на экране: он заменится только новым успешным
    state.ai = { busy: false, error: msg, detail: [s, m].filter(Boolean).join(" ").slice(0, 400) };
  }
  render();
}

function openCustomPeriod() {
  const today = todayStr();
  const cur = state.repCustom || { from: addDays(today, -29), to: today };
  const ov = openSheet(`
    <div class="sheet-head"><h2>Свой период</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="field-grid">
      <label class="field"><span>С</span><input id="rp-from" class="input" type="date" min="${FLOOR_DATE}" max="${today}" value="${cur.from}"></label>
      <label class="field"><span>По</span><input id="rp-to" class="input" type="date" min="${FLOOR_DATE}" max="${today}" value="${cur.to}"></label>
    </div>
    <p class="foot-note" style="margin:0 2px 14px">Можно выбрать любые даты: вся история хранится в аккаунте.</p>
    <button type="button" class="btn primary full" id="rp-ok">Показать</button>`);
  $("#rp-ok", ov).addEventListener("click", () => {
    let from = $("#rp-from", ov).value, to = $("#rp-to", ov).value;
    if (!from || !to) { toast("Выберите обе даты"); return; }
    if (from > to) [from, to] = [to, from];
    if (from < FLOOR_DATE) from = FLOOR_DATE;
    if (to > today) to = today;
    state.repCustom = { from, to };
    ov.close();
    render();
    loadHistory(from);
  });
}

const kv = (label, value, sub) => `<div class="stat"><b>${value}</b><span>${label}${sub ? `<br>${sub}` : ""}</span></div>`;
function rankRows(rows) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  return `<div class="rank">${rows.map((r) => `<div class="rk"><div class="rk-top"><span class="rk-n">${esc(r.name)}</span><span class="rk-v">${r.text}</span></div><div class="rk-bar"><i class="${r.cls || ""}" style="width:${Math.max(2, (r.v / max) * 100)}%"></i></div></div>`).join("")}</div>`;
}

function viewReports() {
  const days = reportDays();
  const n = days.length;
  const a = analyze(days);
  // Длинные периоды на графиках показываются по неделям (среднее за неделю), иначе столбики слишком мелкие
  const step = n > 400 ? 30 : n > 45 ? 7 : 1;
  const grouped = step > 1;
  const gIdx = grouped ? Array.from({ length: Math.ceil(n / step) }, (_, i) => i * step) : null;
  const chartKeys = grouped ? gIdx.map((i) => days[i]) : days;
  const gmap = {};
  if (grouped) gIdx.forEach((i) => { gmap[days[i]] = days.slice(i, i + step); });
  const gfn = (fn) => (grouped ? (k) => { const v = gmap[k].map(fn).filter((x) => x > 0); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0; } : fn);
  const ggoal = (fn) => (!fn || !grouped ? fn : (k) => Math.max(...gmap[k].map(fn)));
  const kper = grouped ? gIdx.map((i) => { const seg = a.per.slice(i, i + step).filter((x) => x.has); return { d: days[i], has: seg.length > 0, kcal: seg.length ? seg.reduce((t, x) => t + x.kcal, 0) / seg.length : 0 }; }) : a.per;
  const by = grouped ? (step === 30 ? "по месяцам (среднее)" : "по неделям (среднее)") : "по дням";
  const active = (v) => (!state.repCustom && state.repDays === v ? "on" : "");
  const goalMax = Math.max(state.goal * 1.15, ...kper.map((x) => x.kcal), 1);
  const bars = kper.map((x) => {
    const h = x.has ? Math.max(2, (x.kcal / goalMax) * 100) : 0;
    const cls = !x.has ? "b zero" : x.kcal > state.goal ? "b over" : "b";
    return `<div class="col"><div class="${cls}" style="height:${x.has ? h : 2}%" title="${dayLabel(x.d)}: ${fmtInt(x.kcal)} ккал"></div></div>`;
  }).join("");
  const goalBottom = (state.goal / goalMax) * 100;

  const ins = localInsights(a);
  const INS_LBL = { bad: "Обратить внимание", warn: "Можно улучшить", good: "В норме", info: "К сведению" };
  const cross = crossInsights(a);
  const crossHtml = cross.verdict || cross.links.length ? `<div class="in-sum">
      <div class="in-h k-${cross.verdict ? cross.verdict.lv : "info"}"><span class="in-em">🧭</span>Итог и связи между показателями</div>
      ${cross.verdict ? `<div class="sum-verdict lv-${cross.verdict.lv}">${esc(cross.verdict.text)}</div>` : ""}
      ${cross.links.length ? cross.links.map((l) => `<div class="in k-${l.kind}"><i></i><p>${esc(l.text)}</p></div>`).join("") : `<p class="foot-note" style="margin:8px 0 0">Чтобы увидеть связи (нагрузка и вода, сон и еда, кофеин и сон), нужно хотя бы по 2 дня каждого типа. Записывайте дальше.</p>`}
    </div>` : "";
  const INS_EM = { bad: "🚨", warn: "💡", good: "✅", info: "ℹ️" };
  const insGroups = ["bad", "warn", "good", "info"].map((k) => ({ k, list: ins.filter((i) => i.kind === k) })).filter((g) => g.list.length);
  const insHtml = `<div class="ins">${insGroups.map((g) => `<div class="in-grp k-${g.k}"><div class="in-h k-${g.k}"><span class="in-em">${INS_EM[g.k]}</span>${INS_LBL[g.k]}<b>${g.list.length}</b></div>${g.list.map((i) => `<div class="in k-${i.kind}"><i></i><p>${esc(i.text)}</p></div>`).join("")}</div>`).join("")}${crossHtml}</div>`;
  const badGroup = insGroups.find((g) => g.k === "bad");
  const insBad = badGroup
    ? `<div class="ins"><div class="in-grp k-bad"><div class="in-h k-bad"><span class="in-em">🚨</span>${INS_LBL.bad}<b>${badGroup.list.length}</b></div>${badGroup.list.map((i) => `<div class="in k-${i.kind}"><i></i><p>${esc(i.text)}</p></div>`).join("")}</div></div>`
    : `<p class="foot-note" style="margin:0">Ничего тревожного не найдено.</p>`;
  const plan = a.plan;
  const macroRow = (name, avg, target, cls) => `<div class="rk"><div class="rk-top"><span class="rk-n">${name}</span><span class="rk-v">${fmt(avg)} г${target ? ` из ${target} г` : ""}</span></div><div class="rk-bar"><i class="${cls}" style="width:${target ? Math.min(100, (avg / target) * 100) : Math.min(100, avg)}%"></i></div></div>`;
  const wdAvg = a.wd.map((x) => (x.n ? x.s / x.n : 0));
  const wdMax = Math.max(...wdAvg, state.goal, 1);
  const wdBars = wdAvg.map((v, i) => `<div class="wd"><div class="wd-col"><div class="b ${v > state.goal * 1.1 ? "over" : v > 0 ? "" : "zero"}" style="height:${v > 0 ? Math.max(3, (v / wdMax) * 100) : 2}%"></div></div><span>${WD_WEEK[i]}</span><small>${v ? fmtInt(v) : "–"}</small></div>`).join("");

  const mealRows = MEALS.map((m) => ({ name: m.name, v: a.mealKcal[m.id], text: `${fmtInt(a.mealKcal[m.id])} ккал · ${Math.round((a.mealKcal[m.id] / a.mealTotal) * 100)}%` }));
  const foodRows = a.topFoods.map((f) => ({ name: f.name, v: f.kcal, text: `${fmtInt(f.kcal)} ккал · ${f.n} раз` }));
  const drinkRows = [];
  if (a.plainWater > 0) drinkRows.push({ name: "Вода", v: a.plainWater, text: `${fmtInt(a.plainWater)} мл`, cls: "water" });
  a.drinkList.slice(0, 8).forEach((d) => drinkRows.push({ name: d.name, v: d.ml, text: `${fmtInt(d.ml)} мл · ${d.n} раз${d.caf > 0 ? ` · ${fmtInt(d.caf)} мг кофеина` : ""}${d.kcal > 0 ? ` · ${fmtInt(d.kcal)} ккал` : ""}`, cls: d.eff < 0 ? "bad" : "water" }));
  drinkRows.sort((x, y) => y.v - x.v);
  const actRows = a.actTypes.map((t) => ({ name: t.name, v: t.min, text: `${fmtInt(t.min)} мин · ${t.n} раз · ${fmtInt(t.kcal)} ккал` }));

  const tab = state.rTab === "detail" ? "detail" : "over";
  const head = `
    ${pageHead("Статистика", "Отчёты")}
    <div class="seg scroll" role="group" aria-label="Период">
      ${REP_PRESETS.map((v) => `<button type="button" data-act="repDays" data-n="${v}" class="${active(v)}">${presetLabel(v)}</button>`).join("")}
      <button type="button" data-act="repCustom" class="${state.repCustom ? "on" : ""}">Свой</button>
    </div>
    <p class="foot-note rp-range">${esc(periodText(days))} · ${n} дн. · еда записана в ${a.L}${state.histBusy ? " · загружаю историю…" : ""}</p>
    <div class="seg full htabs" data-seg="rtab">${[["over", "Общее"], ["detail", "Детали"]].map(([v, t]) => `<button type="button" data-act="reportTab" data-v="${v}" class="${tab === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
  if (tab === "detail") return head + reportDetailHtml(a, days) + `<p class="foot-note" style="margin:6px 4px 0">Нажмите на день, чтобы увидеть записи. Все записи хранятся в вашем аккаунте без ограничения по времени.</p>`;
  // сравнение с предыдущим периодом такой же длины (если там есть данные)
  let prev = null;
  if (!state.repCustom && state.repDays > 0) {
    const pd = Array.from({ length: n }, (_, i) => addDays(days[0], i - n));
    const pa = analyze(pd);
    if (pa.L > 0) prev = pa;
  }
  const dlt = (cur, old, unit) => {
    if (!prev || !(old > 0)) return "";
    const r = Math.round(cur - old);
    if (r === 0) return "как в прошлом периоде";
    return `${r > 0 ? "+" : "−"}${fmtInt(Math.abs(r))}${unit} к прошлым ${n} дн.`;
  };
  const sub = (...x) => x.filter(Boolean).join("<br>");
  const kpi = a.L || a.hydDays || a.actTotalMin || a.stepDays || a.sleepDays ? `<div class="stat-grid">
        ${kv("ккал в день", fmtInt(a.kcalAvg), sub(`цель ${fmtInt(a.goal)}`, dlt(a.kcalAvg, prev && prev.kcalAvg, "")))}
        ${kv("дней с перебором", String(a.overDays), "более 10% к цели")}
        ${kv("белка в день", `${fmtInt(a.pAvg)} г`, sub(plan ? `цель ${plan.protein} г` : "", dlt(a.pAvg, prev && prev.pAvg, " г")))}
        ${kv("жидкость в день", `${fmtInt(a.hydAvg)} мл`, sub(`средняя норма ${fmtInt(a.targetAvg)} мл`, dlt(a.hydAvg, prev && prev.hydAvg, " мл")))}
        ${kv("дней с нормой воды", `${a.normDays} из ${n}`)}
        ${kv("кофеин в день", `${fmtInt(a.cafAvg)} мг`, `допустимо ${a.cafLim} мг`)}
        ${kv("дней выше нормы кофеина", String(a.cafOver))}
        ${kv("нагрузка в неделю", `${fmtInt(a.actTotalMin / a.weeks)} мин`, plan ? `ориентир ${plan.weekly.minutes}` : "")}
        ${kv("сожжено нагрузкой", `${fmtInt(a.actTotalKcal)} ккал`, `активных дней ${a.actDays}`)}
        ${a.stepDays ? kv("шагов в день", fmtInt(a.stepsAvg), sub(`дней с данными ${a.stepDays}`, dlt(a.stepsAvg, prev && prev.stepsAvg, ""))) : ""}
        ${a.sleepDays ? kv("сон за ночь", `${fmt(a.sleepAvg)} ч`, sub(`ночей с данными ${a.sleepDays}`, dlt(a.sleepAvg * 60, prev && prev.sleepAvg * 60, " мин"))) : kv("сон за ночь", "—", "данных пока нет")}
        ${a.sleepDays ? kv("ночей короче 7 ч", String(a.sleepShort), a.bedN ? `засыпаете около ${minToClock(a.bedAvg)}` : "") : ""}
        ${a.restAvg || a.hrAvgAll ? kv("пульс в покое", a.restAvg ? `${fmtInt(a.restAvg)} уд/мин` : "—", a.hrAvgAll ? `средний за день ${fmtInt(a.hrAvgAll)}` : "") : ""}
      </div>` : `<div class="empty"><b>Пока нет данных</b>Запишите еду, воду или нагрузку, и здесь появится статистика.</div>`;
  const wtp = weightBlock(days[0], days[n - 1], `за ${n} дн.`);
  const moreOpen = !!state.moreCharts;
  return head + `
    <section class="card"><h2 class="h2">Все показатели периода</h2>${kpi}</section>
    ${aiCardHtml(days)}
    <section class="card${state.insOpen ? "" : " ins-card"}"${state.insOpen ? "" : ` data-act="toggleIns" role="button"`}>
      <div class="card-top"><h2 class="h2">Краткие выводы</h2><span class="pill">${state.insOpen ? "все" : `${ins.length} · ${ins.filter((i) => i.kind === "bad").length ? "есть важное" : "всё спокойно"}`}</span></div>
      ${state.insOpen ? `${insHtml}<button type="button" class="btn ghost full" style="margin-top:12px" data-act="toggleIns">Скрыть краткие выводы</button>` : `${insBad}<p class="foot-note ins-more">Нажмите на блок, чтобы открыть все выводы ▾</p>`}
    </section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Вес</h2><span class="pill">${wtp.last ? `${fmt(wtp.last.kg)} кг` : "нет записей"}</span></div>
      ${wtp.svg}<p class="chart-note" style="margin:8px 0 0">${wtp.note}</p>
    </section>
    ${trainReportHtml(days[0], days[n - 1])}
    <section class="card">
      <h2 class="h2">Калории ${by}</h2>
      <div class="chart">${bars}<div class="goal" style="bottom:${goalBottom}%"></div></div>
      <div class="chart-labels">${chartLabels(chartKeys)}</div>
      <p class="chart-note">Пунктир: ваша цель ${fmtInt(state.goal)} ккал. Красным отмечены дни с перебором.</p>
    </section>
    ${a.L ? `<section class="card">
      <h2 class="h2">Что я ем чаще всего</h2>
      ${rankRows(foodRows)}
      <p class="chart-note">Продукты и блюда с наибольшим вкладом в калории.</p>
    </section>` : ""}
    ${drinkRows.length ? `<section class="card"><h2 class="h2">Что я пью</h2>${rankRows(drinkRows)}<p class="chart-note">${a.alcMl > 0 ? `Алкоголь за период: ${fmtInt(a.alcMl)} мл. ` : ""}${a.drinkKcalTotal > 0 ? `Калорий из напитков: ${fmtInt(a.drinkKcalTotal)} ккал.` : ""}</p></section>` : ""}
    <button type="button" class="btn ghost full more-charts" data-act="toggleMoreCharts">${moreOpen ? "Скрыть остальные графики ▲" : "Ещё графики ▼"}</button>
    ${moreOpen ? `
    ${a.L ? `<section class="card">
      <h2 class="h2">Белки, жиры, углеводы в день</h2>
      <div class="rank">
        ${macroRow("Белки", a.pAvg, plan && plan.protein, "prot")}
        ${macroRow("Жиры", a.fAvg, plan && plan.fat, "fat")}
        ${macroRow("Углеводы", a.cAvg, plan && plan.carbs, "carb")}
      </div>
      <p class="chart-note">В среднем за день с записями. Доли калорий: белки ${Math.round(a.share.protein * 100)}%, жиры ${Math.round(a.share.fat * 100)}%, углеводы ${Math.round(a.share.carbs * 100)}%.${plan ? "" : " Заполните профиль, чтобы увидеть ориентиры."}</p>
    </section>
    <section class="card">
      <h2 class="h2">По приёмам пищи</h2>
      ${rankRows(mealRows)}
    </section>
    <section class="card">
      <h2 class="h2">По дням недели</h2>
      <div class="wd-grid">${wdBars}</div>
      <p class="chart-note">Средние калории по дням недели (только дни с записями).</p>
    </section>` : ""}
    ${barsCard(`Жидкость ${by}`, chartKeys, gfn(hydrationOn), ggoal(waterTarget), "мл", "water")}
    ${barsCard(`Кофеин ${by}`, chartKeys, gfn((d) => Math.round(caffeineOn(d))), cafLimit, "мг", "caf", true)}
    ${barsCard(`Нагрузки ${by}`, chartKeys, gfn(actMinutes), null, "мин", "")}
    ${barsCard(`Сон ${by}`, chartKeys, gfn((d) => Math.round(sleepHours(d) * 10) / 10), (() => SLEEP_MIN), "ч", "sleep", false, (v) => fmt(v))}
    ${a.stepDays ? barsCard(`Шаги ${by}`, chartKeys, gfn(stepsOn), (() => STEPS_GOAL), "шагов", "") : ""}
    ${actRows.length ? `<section class="card"><h2 class="h2">Нагрузки по видам</h2>${rankRows(actRows)}</section>` : ""}` : ""}
    <p class="foot-note" style="margin:6px 4px 0">Все записи хранятся в вашем аккаунте без ограничения по времени. Старые периоды подгружаются при выборе.</p>`;
}

/* ================= Отчёты: детализация по датам ================= */
function dayDetailHtml(p) {
  const d = p.d;
  const meals = MEALS.map((m) => {
    const items = p.list.filter((e) => e.meal === m.id).sort((a, b) => createdMs(a) - createdMs(b));
    if (!items.length) return "";
    const mk = items.reduce((t, e) => t + (e.kcal || 0), 0);
    return `<div class="dd-sec"><div class="dd-h"><span>${m.name}</span><b>${fmtInt(mk)} ккал</b></div>${items.map((e) => `<div class="dd-i"><span>${esc(e.name)}<small>${fmt(e.grams)} ${e.drink ? "мл" : "г"}</small></span><b>${fmtInt(e.kcal)}</b></div>`).join("")}</div>`;
  }).join("");
  const drinks = (byDateIndex("drinks").get(d) || EMPTY).slice().sort((a, b) => createdMs(a) - createdMs(b));
  const water = waterOn(d);
  const fl = [...(water > 0 ? [`<div class="dd-i"><span>Вода (суммой за день)<small>${fmt(water)} мл</small></span><b>${fmt(water)} мл</b></div>`] : []),
    ...drinks.map((x) => `<div class="dd-i"><span>${esc(x.name)}<small>${timeOf(createdMs(x))} · ${fmt(x.ml)} мл</small></span><b>${signed(Math.round((Number(x.ml) || 0) * (Number(x.pct) || 0) / 100))} мл</b></div>`)].join("");
  const acts = [...workoutsOn(d).map((w) => `<div class="dd-i"><span>${esc(w.name)}<small>${w.minutes ? `${fmtInt(w.minutes)} мин` : ""}${w.distanceKm ? ` · ${fmt(w.distanceKm)} км` : ""} · Apple Watch</small></span><b>${fmtInt(w.kcal || 0)} ккал</b></div>`),
    ...actOn(d).map((a) => `<div class="dd-i"><span>${esc(a.name)}<small>${fmt(a.minutes)} мин</small></span><b>${fmtInt(a.kcal || 0)} ккал</b></div>`)].join("");
  const wkg = weightOn(d);
  const extra = [p.caf > 0 ? `кофеин ${fmtInt(p.caf)} мг` : "", p.steps > 0 ? `${fmtInt(p.steps)} шагов` : "", p.restHr ? `пульс в покое ${fmtInt(p.restHr)}` : "", wkg ? `вес ${fmt(wkg)} кг` : ""].filter(Boolean).join(" · ");
  return `<div class="dd-body">${meals}${fl ? `<div class="dd-sec"><div class="dd-h"><span>Жидкость</span><b>${fmtInt(p.hyd)} мл</b></div>${fl}</div>` : ""}${acts ? `<div class="dd-sec"><div class="dd-h"><span>Нагрузки</span><b>${fmtInt(p.burned)} ккал</b></div>${acts}</div>` : ""}${extra ? `<p class="foot-note" style="margin:8px 0 0">${extra}</p>` : ""}<button type="button" class="btn soft full dd-go" data-act="openDay" data-d="${d}">Открыть в дневнике</button></div>`;
}

function dayRowHtml(p) {
  const open = !!state.openDays[p.d];
  const lvl = p.has ? levelOf(p.kcal / state.goal) : "";
  return `<div class="dd${open ? " open" : ""}"><button type="button" class="dd-row" data-act="toggleDay" data-d="${p.d}">
      <span class="dd-date">${esc(dayLabel(p.d))}</span>
      <span class="dd-kcal ${lvl}">${p.has ? fmtInt(p.kcal) : "—"}<small>ккал</small></span>
      <span class="dd-mini">${p.has ? `Б ${fmtInt(p.protein)} · Ж ${fmtInt(p.fat)} · У ${fmtInt(p.carbs)}` : "еда не записана"}${p.hyd > 0 ? ` · ${fmt(Math.round(p.hyd))} мл` : ""}</span>
      <span class="dd-arrow">${open ? "▲" : "▼"}</span></button>${open ? dayDetailHtml(p) : ""}</div>`;
}

function reportDetailHtml(a, days) {
  const hasData = (p) => p.has || p.hyd > 0 || p.actMin > 0 || p.steps > 0 || weightOn(p.d) > 0;
  const rows = a.per.filter(hasData).reverse();
  if (!rows.length) return `<section class="card"><div class="empty"><b>За этот период нет записей</b>Выберите другой период.</div></section>`;
  if (days.length <= 62) return `<section class="card dd-list">${rows.map(dayRowHtml).join("")}</section>`;
  // длинный период: недели свёрнуты, внутри дни
  const weeks = new Map();
  rows.forEach((p) => { const k = weekStart(p.d); (weeks.get(k) || weeks.set(k, []).get(k)).push(p); });
  return `<section class="card dd-list">${[...weeks.entries()].map(([k, list]) => {
    const logged = list.filter((p) => p.has);
    const avgK = logged.length ? logged.reduce((t, p) => t + p.kcal, 0) / logged.length : 0;
    const open = !!state.openWks[k];
    return `<div class="dw${open ? " open" : ""}"><button type="button" class="dw-row" data-act="toggleWk" data-k="${k}"><span class="dd-date">${esc(shortDate(k))} — ${esc(shortDate(addDays(k, 6)))}</span><span class="dd-kcal ${logged.length ? levelOf(avgK / state.goal) : ""}">${logged.length ? fmtInt(avgK) : "—"}<small>ккал/день</small></span><span class="dd-mini">${logged.length} дн. с едой</span><span class="dd-arrow">${open ? "▲" : "▼"}</span></button>${open ? list.map(dayRowHtml).join("") : ""}</div>`;
  }).join("")}</section>`;
}

/* ================= Состояние: сервер, правила, версия ================= */
// Проверка идёт по запросу к серверу Firestore (не из кэша): так видно, есть ли связь и пускают ли правила
async function checkStatus(force) {
  if (!state.user || state.status.busy) return;
  if (!force && state.status.ts && Date.now() - state.status.ts < 60000) return;
  const st = { busy: true, ts: 0, server: "", rules: "", latest: 0 };
  state.status = st;
  if (state.tab === "me") render();
  const uid = state.user.uid;
  try {
    await getDocFromServer(doc(db, "users", uid, "settings", "profile"));
    st.server = "ok"; st.rules = "ok";
  } catch (e) {
    if (e && e.code === "permission-denied") { st.server = "ok"; st.rules = "denied"; } else st.server = "off";
  }
  if (st.server === "ok" && st.rules === "ok") {
    try { await getDocsFromServer(query(collection(db, "products"), limit(1))); }
    catch (e) { if (e && e.code === "permission-denied") st.rules = "denied"; }
  }
  try {
    const r = await fetchT(`${baseUrl()}index.html`, { cache: "no-store" }, 8000);
    const m = /app\.js\?v=(\d+)/.exec(await r.text());
    st.latest = m ? Number(m[1]) : 0;
  } catch { st.latest = 0; }
  st.busy = false;
  st.ts = Date.now();
  if (state.status === st && state.tab === "me") render();
}

function statusHtml() {
  const s = state.status;
  const G = "#1B9D4B", R = "#D64545", Y = "#E0A800", N = "#98A39B";
  const row = (name, c, text) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)"><span>${name}</span><b style="text-align:right"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};margin-right:8px"></i>${esc(text)}</b></div>`;
  const wait = s.busy;
  const server = wait ? [N, "Проверяю…"] : !s.server ? [N, "Не проверено"] : s.server === "ok" ? [G, "Подключён"] : [R, "Не подключён"];
  const rules = wait ? [N, "Проверяю…"] : !s.rules ? [N, "Не проверено"] : s.rules === "ok" ? [G, "Работают, доступ есть"] : s.rules === "denied" ? [R, "Блокируют доступ"] : [N, "Не проверить без связи"];
  const ver = s.latest > APP_VERSION ? [Y, `v${APP_VERSION}, на сервере уже v${s.latest}: закройте и откройте приложение`] : s.latest ? [G, `v${APP_VERSION}, актуальная`] : [N, `v${APP_VERSION}`];
  const allReady = Object.values(state.ready).every(Boolean);
  const sync = state.error ? [R, "Ошибка загрузки"] : allReady ? [G, "Данные загружены"] : [Y, "Загружаю…"];
  return `<div style="margin-top:14px">
    ${row("Вход", state.user ? G : R, state.user ? "Выполнен" : "Не выполнен")}
    ${row("Интернет", navigator.onLine ? G : R, navigator.onLine ? "Есть" : "Нет")}
    ${row("Сервер (Firestore)", server[0], server[1])}
    ${row("Правила Firestore", rules[0], rules[1])}
    ${row("Версия приложения", ver[0], ver[1])}
    ${row("Синхронизация данных", sync[0], sync[1])}
    ${row("Gemini (ключ)", geminiKey() ? G : N, geminiKey() ? "Подключён" : "Не подключён")}
    <button type="button" class="btn ghost full" style="margin-top:10px" data-act="checkStatus" ${wait ? "disabled" : ""}>${wait ? "Проверяю…" : "Проверить снова"}</button>
    <button type="button" class="btn soft full" style="margin-top:8px" data-act="reloadApp">Обновить приложение до актуальной версии</button>
  </div>`;
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
    <section class="card"><div class="me-head">${avatar}<div><div class="me-name">${esc(u.displayName || "Без имени")}</div><div class="me-mail">${esc(u.email || "")}</div></div></div>${statusHtml()}</section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Оформление</h2></div>
      <div class="seg full" data-seg="theme">${[["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([v, t]) => `<button type="button" data-act="setTheme" data-v="${v}" class="${themePref() === v ? "on" : ""}">${t}</button>`).join("")}</div>
      <p class="foot-note" style="margin:10px 2px 0">«Авто» следует настройке iPhone: вечером включается тёмная.</p>
    </section>
    ${planCardHtml()}
    <section class="card">
      <h2 class="h2">Дневная цель</h2>
      <label class="field"><span>Калории в день</span><input id="goal-input" class="input" inputmode="numeric" value="${state.goal}" autocomplete="off"></label>
      ${splitFieldsHtml()}
      <button type="button" class="btn primary full" data-act="saveGoal">Сохранить цель</button>
    </section>
    ${quickCardHtml()}
    <section class="card">
      <h2 class="h2">Общая база продуктов</h2>
      <p class="foot-note" style="margin:0">Всего продуктов: <b>${state.products.length}</b>. Добавили вы: <b>${state.products.filter((p) => p.createdBy === u.uid).length}</b>. Дневник и цель видите только вы.</p>
    </section>
    <section class="card"><button type="button" class="btn danger full" data-act="logout">Выйти из аккаунта</button></section>`;
}

/* ================= Штрих-коды, Open Food Facts, камера ================= */
const normBC = (s) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");
// Продукт по штрих-коду: основной код продукта или привязанный код другой упаковки
const findByBarcode = (code) => {
  const k = normBC(code);
  if (!k) return null;
  const own = state.products.find((p) => normBC(p.barcode) === k);
  if (own) return own;
  const id = state.bcMap && state.bcMap[k];
  return id ? state.products.find((p) => p.id === id) || null : null;
};
const aliasCodes = (productId) => Object.keys(state.bcMap || {}).filter((k) => state.bcMap[k] === productId);
function linkBarcode(code, productId) {
  const k = normBC(code);
  state.bcMap = { ...state.bcMap, [k]: productId }; state.bcOwner = { ...state.bcOwner, [k]: state.user.uid };
  setDoc(doc(db, "barcodes", k), { productId, createdBy: state.user.uid, createdAt: serverTimestamp() }).catch(writeFail);
}
function unlinkBarcode(code) {
  const k = normBC(code);
  const m = { ...state.bcMap }; delete m[k]; state.bcMap = m;
  deleteDoc(doc(db, "barcodes", k)).catch(writeFail);
}
const OFF_NOTE = "Данные из Open Food Facts. Сверьте с упаковкой и при необходимости поправьте.";
const NEW_BC_NOTE = "Этого продукта нет в общей базе. Введите данные с упаковки один раз: дальше он будет находиться по штрих-коду.";
const OFF_FAIL_NOTE = "Не удалось связаться с Open Food Facts. Введите данные с упаковки вручную.";
const offNum = (v) => { if (v === undefined || v === null || v === "") return ""; const n = Number(v); return Number.isFinite(n) ? r1(n) : ""; };

const DRINK_TAG = /en:beverages|en:drinks|en:waters|en:carbonated-drinks|en:energy-drinks|en:sodas|en:juices|en:fruit-juices|en:nectars|en:alcoholic-beverages|plant-based-beverages|en:iced-teas|en:lemonades/;

// Напиток ли это, какая у него гидратация и есть ли кофеин. Всё проверяется человеком в форме продукта.
function guessDrink(p) {
  const tags = (p.categories_tags || []).join(" ").toLowerCase();
  const ing = `${(p.ingredients_tags || []).join(" ")} ${p.ingredients_text || ""}`.toLowerCase();
  const n = p.nutriments || {};
  const liquidQty = /\d\s*(ml|мл|cl|l|л)\b/i.test(String(p.quantity || ""));
  const soupy = /\bsoups?\b|broths?|borsch|borscht/.test(tags);
  if (!(DRINK_TAG.test(tags) || liquidQty || soupy)) return {};
  const has = (re) => re.test(tags);
  let like = "";
  if (soupy) like = "soup";
  else if (has(/energy-drink/)) like = "energy";
  else if (has(/iced-tea/)) like = "icedtea";
  else if (has(/lemonade/)) like = "lemonade";
  else if (has(/\bsodas?\b|carbonated-drinks|\bcolas?\b/)) like = has(/diet|light|zero|no-sugar|sweetened/) ? "dietsoda" : "soda";
  else if (has(/juice|nectar/)) like = "juice";
  else if (has(/\bwaters?\b|mineral-water|spring-water/)) like = "mineral";
  else if (has(/\bbeers?\b/)) like = "beer";
  else if (has(/\bwines?\b/)) like = "redwine";
  else if (has(/spirit|liquor|vodka|whisk|brandy|\brum\b|\bgin\b|tequila/)) like = "strong";
  else if (has(/decaf/)) like = has(/coffee/) ? "decaf" : "decaftea";
  else if (has(/herbal|infusion|fruit-tea|rooibos/)) like = "herbaltea";
  else if (has(/\bcoffees?\b/)) like = "coffee";
  else if (has(/\bteas?\b/)) like = "blacktea";
  else if (has(/\bmilks?\b|dairy-drinks|kefir/)) like = "milk";
  else if (has(/plant-based-beverage|soy|oat-drink|almond/)) like = "soymilk";
  const base = like ? DRINK_BY_ID[like] : null;
  const labelCaf = n.caffeine_100g !== undefined && n.caffeine_100g !== null && n.caffeine_100g !== "" && Number.isFinite(Number(n.caffeine_100g));
  const mention = /caffeine|кофеин|кофеїн|guarana|гуарана/.test(ing);
  let caf = 0, cafGuess = false;
  if (labelCaf) caf = r1(Number(n.caffeine_100g) * 1000);   // на упаковке указано граммами на 100 мл
  else if (base && base.c > 0) { caf = r1((base.c / 240) * 100); cafGuess = true; }
  else if (mention) { caf = 10; cafGuess = true; }          // кофеин в составе есть, а количество не указано
  return { drink: true, hydrationPct: base ? base.h : 90, caffeineMg100: caf, cafGuess, like };
}
const drinkNote = (d) => (d && d.drink
  ? ` Определили, что это напиток: проверьте гидратацию и кофеин ниже.${d.cafGuess ? " Количество кофеина оценено по виду напитка: сверьте с упаковкой." : ""}`
  : "");

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
    ...guessDrink(p),
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

const OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,categories_tags,ingredients_tags,ingredients_text,quantity";

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

// ---------- Собственный сканер EAN-13 (без внешних библиотек, работает всегда) ----------
const EAN_L = ["3211","2221","2122","1411","1132","1231","1114","1312","1213","3112"];
const EAN_G = EAN_L.map((p) => p.split("").reverse().join(""));
const EAN_PAR = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
function eanDigit(w, tables) {
  const sum = w[0] + w[1] + w[2] + w[3];
  if (sum <= 0) return null;
  let best = null, bestErr = 1e9;
  for (const [kind, table] of tables) {
    for (let d = 0; d < 10; d++) {
      let err = 0;
      for (let k = 0; k < 4; k++) { const diff = (w[k] * 7) / sum - Number(table[d][k]); err += diff * diff; }
      if (err < bestErr) { bestErr = err; best = { d, kind }; }
    }
  }
  return bestErr < 1.4 ? best : null;
}
function eanChecksumOk(c) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(c[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(c[12]);
}
// runs: [{b:true/false, w:число}] -> код или null
function decodeEanRuns(runs) {
  for (let i = 0; i + 59 <= runs.length; i++) {
    if (!runs[i].b) continue;
    const g0 = runs[i].w, g1 = runs[i + 1].w, g2 = runs[i + 2].w;
    const u = (g0 + g1 + g2) / 3;
    if (u < 1.2) continue;
    if (Math.max(g0, g1, g2) > u * 1.8 || Math.min(g0, g1, g2) < u * 0.45) continue;
    // тихая зона слева (если есть предыдущий пробел) должна быть заметно больше модуля
    if (i > 0 && runs[i - 1].w < u * 3) continue;
    let p = i + 3, left = "", par = "", ok = true;
    for (let k = 0; k < 6 && ok; k++, p += 4) {
      const r = eanDigit([runs[p].w, runs[p + 1].w, runs[p + 2].w, runs[p + 3].w], [["L", EAN_L], ["G", EAN_G]]);
      if (!r) ok = false; else { left += r.d; par += r.kind; }
    }
    if (!ok) continue;
    const mid = [runs[p], runs[p + 1], runs[p + 2], runs[p + 3], runs[p + 4]];
    if (mid.some((m) => m.w > u * 2.2 || m.w < u * 0.4)) continue;
    p += 5;
    let right = "";
    for (let k = 0; k < 6 && ok; k++, p += 4) {
      const r = eanDigit([runs[p].w, runs[p + 1].w, runs[p + 2].w, runs[p + 3].w], [["R", EAN_L]]);
      if (!r) ok = false; else right += r.d;
    }
    if (!ok) continue;
    const first = EAN_PAR.indexOf(par);
    if (first < 0) continue;
    const code = String(first) + left + right;
    if (eanChecksumOk(code)) return code;
  }
  return null;
}
// Одна строка яркости -> серия чёрно-белых отрезков (адаптивный порог против бликов)
function rowToRuns(row) {
  const n = row.length;
  const win = Math.max(24, Math.round(n / 6));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + row[i];
  const runs = [];
  let cur = null, w = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(n, i + win + 1);
    const mean = (pre[hi] - pre[lo]) / (hi - lo);
    const black = row[i] < mean - 6;
    if (cur === null) { cur = black; w = 1; }
    else if (black === cur) w++;
    else { runs.push({ b: cur, w }); cur = black; w = 1; }
  }
  if (cur !== null) runs.push({ b: cur, w });
  return runs;
}
function decodeRow(row) {
  const runs = rowToRuns(row);
  if (runs.length < 59) return null;
  const c = decodeEanRuns(runs);
  if (c) return c;
  const rev = runs.slice().reverse(); // код вверх ногами
  return decodeEanRuns(rev);
}
function lumaOfCanvas(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const y = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < y.length; i += 4, j++) y[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return { w, h, y };
}
function transposeLuma(L) {
  const { w, h, y } = L;
  const t = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) t[c * h + r] = y[r * w + c];
  return { w: h, h: w, y: t };
}
function scanLuma(L, step) {
  const { w, h, y } = L;
  for (let r = 0; r < h; r += step) {
    for (const off of [0, 1]) {
      // усредняем две-три соседние строки: меньше шума
      const row = new Uint8Array(w);
      const r1 = Math.min(h - 1, r + off + 1);
      for (let x = 0; x < w; x++) row[x] = (y[r * w + x] + y[r1 * w + x] + y[Math.min(h - 1, r + off) * w + x]) / 3;
      const c = decodeRow(row);
      if (c) return c;
    }
  }
  return null;
}
// Пробуем кадр как есть и повёрнутым на 90° (код может лежать боком)
function ownDecodeCanvas(canvas, step = 3) {
  const L = lumaOfCanvas(canvas);
  return scanLuma(L, step) || scanLuma(transposeLuma(L), step);
}

// ---------- Дополнительный распознаватель: встроенный BarcodeDetector или WebAssembly с CDN ----------
const BC_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const DETECTOR_URLS = [
  "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.1/dist/es/ponyfill.min.js",
  "https://fastly.jsdelivr.net/npm/barcode-detector@3.2.1/dist/es/ponyfill.min.js",
  "https://unpkg.com/barcode-detector@3.2.1/dist/es/ponyfill.min.js",
];
const diag = { engine: "собственный", wasm: "не загружен", lastErr: "", frames: 0 };
let detectorPromise = null;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ("BarcodeDetector" in window) {
        try {
          const sup = await window.BarcodeDetector.getSupportedFormats();
          if (sup.includes("ean_13")) { diag.wasm = "системный"; return new window.BarcodeDetector({ formats: BC_FORMATS.filter((f) => sup.includes(f)) }); }
        } catch { /* перейдём на WebAssembly */ }
      }
      for (const url of DETECTOR_URLS) {
        try {
          const mod = await import(url);
          const det = new mod.BarcodeDetector({ formats: BC_FORMATS });
          const warm = document.createElement("canvas");
          warm.width = warm.height = 8;
          await det.detect(warm); // если WASM не скачался — упадёт здесь, а не на живом кадре
          diag.wasm = "WASM";
          return det;
        } catch (e) { diag.lastErr = String((e && e.message) || e).slice(0, 60); console.warn("Не загрузился распознаватель:", url, e); }
      }
      diag.wasm = "недоступен";
      return null;
    })().then((d) => { if (!d) setTimeout(() => { detectorPromise = null; }, 15000); return d; });
  }
  return detectorPromise;
}

const firstCode = (results) => { const hit = (results || []).find((r) => r && r.rawValue); return hit ? String(hit.rawValue) : null; };

function frameToCanvas(source, sw, sh, maxSide, canvas) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Живое сканирование: кадр обрабатывается собственным сканером и (когда загрузится) дополнительным распознавателем.
async function startLiveScan(video, onCode, isDone, onStatus, onTorch) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* не везде поддерживается */ }
  // Подсветка: включается через камеру, если браузер это разрешает (Android/Chrome; на iPhone в Safari обычно нет)
  let caps = {};
  try { caps = (track.getCapabilities && track.getCapabilities()) || {}; } catch { /* ignore */ }
  let torchOn = false;
  const setTorch = async (on) => {
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    torchOn = !!on;
    return torchOn;
  };
  if (onTorch) onTorch({ supported: !!caps.torch, toggle: () => setTorch(!torchOn) });
  let dark = 0;
  let det = null;
  getDetector().then((d) => { det = d; }).catch(() => {});
  const canvas = document.createElement("canvas");
  let busy = false;
  let n = 0;
  const timer = setInterval(async () => {
    if (busy || isDone() || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      n++; diag.frames = n;
      frameToCanvas(video, video.videoWidth, video.videoHeight, 1280, canvas);
      if (n % 8 === 1 && onTorch) {
        // средняя яркость кадра: тёмный кадр -> предлагаем подсветку
        const sm = document.createElement("canvas"); sm.width = sm.height = 16;
        const sx = sm.getContext("2d", { willReadFrequently: true }); sx.drawImage(canvas, 0, 0, 16, 16);
        const px = sx.getImageData(0, 0, 16, 16).data; let t = 0;
        for (let i = 0; i < px.length; i += 4) t += (px[i] + px[i + 1] + px[i + 2]) / 3;
        dark = t / 256;
        onTorch({ dark: dark < 70 });
      }
      let code = ownDecodeCanvas(canvas, 4);
      if (!code && det) {
        try { code = firstCode(await det.detect(canvas)); } catch (e) { diag.lastErr = String((e && e.message) || e).slice(0, 60); }
      }
      if (code && !isDone()) onCode(code);
      else if (n % 6 === 0 && onStatus) onStatus(`Кадров: ${n} · движок: собственный + ${diag.wasm}${diag.lastErr ? " · " + diag.lastErr : ""}`);
    } catch (e) { diag.lastErr = String((e && e.message) || e).slice(0, 60); console.warn("Кадр не распознан:", e); } finally { busy = false; }
  }, 140);
  return () => {
    clearInterval(timer);
    if (torchOn) { try { track.applyConstraints({ advanced: [{ torch: false }] }); } catch { /* ignore */ } }
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// Запасной вариант: библиотека ZXing-js (если подгрузится)
async function zxingFromUrl(url) {
  const ZX = await loadZXing();
  return (await new ZX.BrowserMultiFormatReader().decodeFromImageUrl(url)).getText();
}

// Распознавание по фотографии: несколько масштабов, повороты, затем запасные движки
async function decodeFromFile(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let code = null;
  try {
    for (const side of [1600, 1000, 2400]) {
      frameToCanvas(bmp, bmp.width, bmp.height, side, canvas);
      code = ownDecodeCanvas(canvas, 2);
      if (code) return code;
    }
  } finally { if (bmp.close) { /* закроем позже */ } }
  const det = await Promise.race([getDetector(), new Promise((r) => setTimeout(() => r(null), 8000))]);
  if (det) {
    frameToCanvas(bmp, bmp.width, bmp.height, 2000, canvas);
    try { code = firstCode(await det.detect(canvas)); } catch (e) { diag.lastErr = String((e && e.message) || e).slice(0, 60); }
    if (code) return code;
  }
  try {
    const url = URL.createObjectURL(file);
    try { code = await zxingFromUrl(url); } finally { URL.revokeObjectURL(url); }
    if (code) return code;
  } catch { /* ignore */ }
  return null;
}

function openScanner(onCode) {
  const ov = document.createElement("div");
  ov.className = "scanner";
  ov.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scan-frame"></div>
    <button type="button" class="icon-btn scan-torch hidden" id="sc-torch" aria-label="Подсветка">🔦</button>
    <button type="button" class="icon-btn scan-close" data-sc-close aria-label="Закрыть">×</button>
    <div class="scan-bottom">
      <p class="scan-hint" id="sc-hint">Запускаю камеру…</p>
      <p class="scan-diag" id="sc-diag"></p>
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
  let torchCtl = null;
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
      else setHint("Код на фото не распознан. Сфотографируйте ближе, чтобы код занял почти весь кадр, или введите цифры вручную." + (diag.lastErr ? " [" + diag.lastErr + "]" : ""));
    } catch (err) {
      console.error("Фото:", err);
      if (!done) setHint("Не удалось прочитать фото. Введите код вручную.");
    }
  });

  (async () => {
    try {
      const c = await startLiveScan(video, finish, () => done, (t) => { const d = $("#sc-diag", ov); if (d) d.textContent = t; }, (info) => {
        const tb = $("#sc-torch", ov);
        if (!tb) return;
        if (info.toggle) {
          torchCtl = info;
          tb.classList.remove("hidden");
          tb.onclick = async () => {
            try { const on = await info.toggle(); tb.classList.toggle("on", on); }
            catch { setHint(info.supported ? "Не удалось включить подсветку." : "Этот телефон не даёт включить вспышку из браузера. Включите фонарик в Пункте управления и наведите камеру."); }
          };
          if (!info.supported) tb.classList.add("nosup");
        }
        if (info.dark && !tb.classList.contains("on")) setHint("Темно. Нажмите 🔦 вверху, чтобы включить подсветку.");
      });
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

// Окно «Новый штрих-код»: привязать к существующему продукту или создать новый. Возвращает {product} | {} (новый) | null (закрыто)
function askLinkBarcode(code) {
  return new Promise((resolve) => {
    let done = false, q = "";
    const finish = (v) => { if (done) return; done = true; resolve(v); ov.close(); };
    const ov = openSheet(`
      <div class="sheet-head af-head"><h2 style="flex:1;margin:0">Новый штрих-код</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
      <div id="af-body" class="lm">
        <div class="note lk-note">Код ${esc(code)} не найден. Привяжите его к знакомому продукту (новая упаковка) или создайте новый.</div>
        <div class="af-btns lk-btns"><button type="button" class="btn ghost" id="lk-new">Это новый продукт</button></div>
        <input id="lk-q" class="input search" type="search" placeholder="Найти продукт для привязки" autocomplete="off">
        <div id="lk-list" class="plist"></div>
      </div>`);
    ov.classList.add("top");
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        if (!ov.isConnected) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); return; }
        ov.style.top = `${vv.offsetTop}px`; ov.style.height = `${vv.height}px`; ov.style.bottom = "auto";
      };
      vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
    }
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) finish(null); });
    const draw = () => {
      const items = filterProducts(q).slice(0, 40);
      $("#lk-list", ov).innerHTML = items.length ? items.map((p) => productRow(p, "data-pick")).join("") : `<div class="empty"><b>Ничего не найдено</b>Попробуйте другое название.</div>`;
    };
    draw();
    $("#lk-q", ov).addEventListener("input", (e) => { q = e.target.value; draw(); });
    $("#lk-list", ov).addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      const p = b && state.products.find((x) => x.id === b.dataset.pick);
      if (p) finish({ product: p });
    });
    $("#lk-new", ov).addEventListener("click", () => finish({}));
  });
}

// Окно «Что создать?»: напиток или продукт. Для нового штрих-кода можно ещё привязать его к уже имеющемуся напитку.
// Возвращает {kind:"drink"|"product"} | {drink} | null
function chooseCardKind(code) {
  return new Promise((resolve) => {
    let done = false, q = "";
    const finish = (v) => { if (done) return; done = true; resolve(v); ov.close(); };
    const mine = code ? customList() : [];
    const ov = openSheet(`
      <div class="sheet-head af-head"><h2 style="flex:1;margin:0">Что создать?</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
      <div class="lm">
        <div class="note lk-note">${code ? `Код ${esc(code)} не найден ни среди продуктов, ни среди напитков. ` : ""}Напиток считается как жидкость (и кофеин), а если есть калории, то и как еда. Продукт считается только как еда.</div>
        <div class="af-btns lk-btns"><button type="button" class="btn primary" id="ck-drink">Напиток</button><button type="button" class="btn primary" id="ck-prod">Продукт</button></div>
        ${mine.length ? `<p class="foot-note" style="margin:6px 2px 8px">Или это новая упаковка уже имеющегося напитка:</p>
        <input id="ck-q" class="input search" type="search" placeholder="Найти напиток для привязки" autocomplete="off">
        <div id="ck-list" class="plist"></div>` : ""}
      </div>`);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) finish(null); });
    $("#ck-drink", ov).addEventListener("click", () => finish({ kind: "drink" }));
    $("#ck-prod", ov).addEventListener("click", () => finish({ kind: "product" }));
    if (mine.length) {
      const draw = () => {
        const w = fold(q).split(/\s+/).filter(Boolean);
        const items = mine.filter((d) => w.every((x) => fold(d.n).includes(x))).slice(0, 30);
        $("#ck-list", ov).innerHTML = items.length ? items.map((d) => `<button type="button" class="prow" data-pick="${d.id}"><span><span class="p-name">${esc(d.n)}</span></span></button>`).join("") : `<div class="empty"><b>Ничего не найдено</b></div>`;
      };
      draw();
      $("#ck-q", ov).addEventListener("input", (e) => { q = e.target.value; draw(); });
      $("#ck-list", ov).addEventListener("click", (e) => {
        const b = e.target.closest("[data-pick]");
        const d = b && mine.find((x) => x.id === b.dataset.pick);
        if (d) finish({ drink: d });
      });
    }
  });
}
function addDrinkCode(id, code) {
  const c = String(code).replace(/\D/g, "");
  const sh = (state.sharedDrinks || []).find((x) => x.id === id);
  if (sh) { updateDoc(doc(db, "drinkdb", id), { bc: [...(Array.isArray(sh.bc) ? sh.bc : []), c].slice(0, 12), updatedAt: serverTimestamp() }).catch(writeFail); return; }
  state.customDrinks = state.customDrinks.map((x) => (x.id === id ? { ...x, bc: [...(Array.isArray(x.bc) ? x.bc : []), c] } : x));
  saveCustomDrinks();
}
// Создание карточки без известного кода: сначала выбор «напиток / продукт»
async function newCardFlow(prefill, onSaved, onDrink) {
  const c = await chooseCardKind("");
  if (!c) return;
  if (c.kind === "drink") (onDrink || ((id, pre) => openDrinkSheet(null, id, 0, pre)))(null, { card: true, n: (prefill && prefill.name) || "" });
  else openProductForm(null, onSaved, prefill || {});
}

// Найти карточку по штрих-коду: напиток или продукт у себя, потом выбор типа, Open Food Facts, ручной ввод.
// onDrink(id, prefill): открыть напиток (id) или форму нового напитка (prefill)
async function processBarcode(code, onOwn, onSaved, onDrink) {
  const openDrink = onDrink || ((id, pre) => openDrinkSheet(null, id, 0, pre));
  const dr = findDrinkByBarcode(code);
  if (dr) { openDrink(dr.id); return; }
  const own = findByBarcode(code);
  if (own) { onOwn(own); return; }
  const c = await chooseCardKind(code);
  if (!c) return;
  if (c.drink) { addDrinkCode(c.drink.id, code); toast(`Код добавлен к напитку «${c.drink.n}»`); openDrink(c.drink.id); return; }
  if (c.kind === "drink") {
    toast("Ищу в Open Food Facts…");
    const r = await fetchOFF(code);
    const pre = { card: true, bc: [code], n: "" };
    if (r.state === "found") {
      const d = r.data, like = d.like && DRINK_BY_ID[d.like];
      Object.assign(pre, { n: d.name || d.brand || "", k: d.kcal === "" ? 0 : d.kcal, p: d.protein || 0, f: d.fat || 0, cb: d.carbs || 0, h: d.drink ? d.hydrationPct : 90, c: d.drink ? r1((Number(d.caffeineMg100) || 0) * 2.4) : 0, cat: like ? like.cat : "other", a: like && like.cat === "alc" ? like.a : "" });
      toast("Данные найдены. Сверьте их с упаковкой.");
    } else toast(r.state === "none" ? "В базе нет этого кода. Введите данные с упаковки." : "Не удалось связаться с Open Food Facts.");
    openDrink(null, pre);
    return;
  }
  // неизвестный код: сначала предлагаем привязать его к уже существующему продукту (новая упаковка)
  if (state.products.length) {
    const choice = await askLinkBarcode(code);
    if (choice && choice.product) { linkBarcode(code, choice.product.id); onOwn(choice.product); return; }
    if (!choice) return;
  }
  toast("Ищу в Open Food Facts…");
  const r = await fetchOFF(code);
  if (r.state === "found") openProductForm(null, onSaved, { ...r.data, source: "off", note: OFF_NOTE });
  else if (r.state === "none") openProductForm(null, onSaved, { barcode: code, note: NEW_BC_NOTE });
  else openProductForm(null, onSaved, { barcode: code, note: OFF_FAIL_NOTE });
}

// Переименованные позиции базового набора: если у человека уже есть старое название, новое не предлагаем второй раз
const STARTER_OLD = { "Яйцо куриное (жареное, глазунья)": "Яичница-глазунья", "Яйцо куриное (болтунья)": "Яичница-болтунья" };
const starterMissing = () => {
  const have = new Set(state.products.map((p) => fold(p.name)));
  return STARTER.filter((x) => !have.has(fold(x[0])) && !(STARTER_OLD[x[0]] && have.has(fold(STARTER_OLD[x[0]]))));
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

function previewHtml(per100, grams, info, replaceMg = 0) {
  const zero = `<div class="pv-kcal">0<small>ккал</small></div><div class="pv-macros"><div><b>0</b>белки, г</div><div><b>0</b>жиры, г</div><div><b>0</b>углеводы, г</div></div>`;
  const c = grams > 0 ? calc(per100, grams) : null;
  const base = c ? `<div class="pv-kcal">${fmtInt(c.kcal)}<small>ккал</small></div>
    <div class="pv-macros"><div><b>${fmt(c.protein)}</b>белки, г</div><div><b>${fmt(c.fat)}</b>жиры, г</div><div><b>${fmt(c.carbs)}</b>углеводы, г</div></div>` : zero;
  if (!info) return base;
  const ml = grams > 0 ? grams : 0, eff = (ml * info.pct) / 100, caf = (ml * info.caf100) / 100;
  return `${base}<p class="foot-note" style="margin:10px 0 0">Жидкость: <b>${signed(Math.round(eff))} мл</b> засчитано${caf > 0 ? `. Кофеин: <b>${fmtInt(caf)} мг</b>` : ""}.</p>${caf > 0 ? cafWarnHtml(caf, replaceMg) : ""}`;
}

/* ----- Когда я ел этот продукт: все записи дневника за всё время ----- */
const bju = (p, f, c) => `<span class="p-macros">${macrosHtml(Number(p) || 0, Number(f) || 0, Number(c) || 0)}</span>`;
async function openProductUsage(p) {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Когда я это ел</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <p class="foot-note" style="margin:0 2px 10px"><b>${esc(p.name)}</b>${p.brand ? `, ${esc(p.brand)}` : ""}</p>
    <div id="pu-body"><div class="empty">Загружаю…</div></div>`);
  let list = [];
  try {
    const snap = await getDocs(query(collection(db, "users", state.user.uid, "entries"), where("productId", "==", p.id)));
    list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    list = state.entries.filter((e) => e.productId === p.id);
  }
  const wd = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  list.sort((a, b) => (a.date === b.date ? createdMs(b) - createdMs(a) : a.date < b.date ? 1 : -1));
  const body = $("#pu-body", ov);
  if (!body) return;
  if (!list.length) { body.innerHTML = `<div class="empty"><b>Пока не ел</b>Этого продукта ещё нет в вашем дневнике.</div>`; return; }
  const sumG = list.reduce((t, e) => t + (Number(e.grams) || 0), 0), sumK = list.reduce((t, e) => t + (Number(e.kcal) || 0), 0);
  const days = new Set(list.map((e) => e.date)).size;
  const rows = list.map((e) => `<div class="pu-row"><span class="pu-d"><b>${esc(shortDate(e.date))}</b><small>${wd[parseD(e.date).getDay()]}${MEAL_NAME[e.meal] ? `, ${esc(MEAL_NAME[e.meal].toLowerCase())}` : ""}</small></span><span class="pu-g">${fmtInt(Number(e.grams) || 0)} г</span><span class="pu-k">${fmtInt(Number(e.kcal) || 0)} ккал</span><span class="pu-m">${bju(e.protein, e.fat, e.carbs)}</span></div>`).join("");
  const sm = (k) => list.reduce((t, e) => t + (Number(e[k]) || 0), 0);
  const avgG = sumG / list.length, last = list[0].date, daysAgo = Math.round((parseD(todayStr()) - parseD(last)) / 86400000);
  const lastTxt = daysAgo <= 0 ? "сегодня" : daysAgo === 1 ? "вчера" : `${daysAgo} дн. назад`;
  body.innerHTML = `<div class="pu-info">Последний раз: <b>${lastTxt}</b> · средняя порция <b>${fmtInt(avgG)} г</b> (${fmtInt(sumK / list.length)} ккал)</div>
    <div class="pu-sum"><div><b>${list.length}</b><small>${list.length === 1 ? "запись" : "записей"}</small></div><div><b>${days}</b><small>дн.</small></div><div><b>${fmtInt(sumG)} г</b><small>всего</small></div><div><b>${fmtInt(sumK)}</b><small>ккал всего</small></div></div>
    <div class="pu-tot"><span>БЖУ за всё время</span>${bju(sm("protein"), sm("fat"), sm("carbs"))}</div>
    <div class="pu-list">${rows}</div>`;
}

/* ----- Откуда взялись белки / жиры / углеводы за день ----- */
function openMacroTop(key) {
  const NAMES = { protein: ["Белки", "var(--protein)"], fat: ["Жиры", "var(--fat)"], carbs: ["Углеводы", "var(--carbs)"] };
  const [title, color] = NAMES[key] || NAMES.protein;
  const list = entriesOn(state.date);
  const groups = new Map();
  let total = 0;
  list.forEach((e) => {
    const g = Number(e[key]) || 0;
    if (g <= 0) return;
    total += g;
    const k = fold(e.name);
    const r = groups.get(k) || { name: e.name, g: 0, kcal: 0, grams: 0, n: 0 };
    r.g += g; r.kcal += Number(e.kcal) || 0; r.grams += Number(e.grams) || 0; r.n++;
    groups.set(k, r);
  });
  const top = [...groups.values()].sort((a, b) => b.g - a.g).slice(0, 10);
  const mg = macroGoals(), goal = mg ? Math.round(mg[key]) : 0;
  const rows = top.map((r, i) => {
    const share = total > 0 ? Math.round((r.g / total) * 100) : 0;
    return `<div class="mt-row"><span class="mt-n">${i + 1}</span><span class="mt-main"><span class="mt-name">${esc(r.name)}</span><span class="mt-sub">${fmtInt(r.grams)} г${r.n > 1 ? `, записей: ${r.n}` : ""} · ${fmtInt(r.kcal)} ккал</span><span class="mt-bar"><i style="width:${share}%;background:${color}"></i></span></span><span class="mt-val">${fmt(r.g)} г<small>${share}%</small></span></div>`;
  }).join("");
  const ov = openSheet(`
    <div class="sheet-head"><h2>${title}: главные источники</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <p class="foot-note" style="margin:0 2px 10px">За ${esc(shortDate(state.date))}: всего ${fmt(total)} г${goal ? ` из ${fmtInt(goal)} г цели` : ""}. Доля считается от суммы за день.</p>
    <div class="mt-list">${rows || `<div class="empty"><b>Пока нет записей</b>Добавьте еду в дневник.</div>`}</div>`);
}

// Быстрое повторение: последние 6 разных продуктов из дневника и 6 самых частых (по записям за 90 дней)
function quickProducts() {
  const byId = new Map(state.products.map((p) => [p.id, p]));
  const es = state.entries.filter((e) => byId.has(e.productId)).slice().sort((a, b) => (a.date === b.date ? createdMs(b) - createdMs(a) : a.date < b.date ? 1 : -1));
  const recent = [], seen = new Set();
  for (const e of es) { if (!seen.has(e.productId)) { seen.add(e.productId); recent.push(byId.get(e.productId)); if (recent.length >= 6) break; } }
  const cnt = new Map();
  es.forEach((e) => cnt.set(e.productId, (cnt.get(e.productId) || 0) + 1));
  const freq = [...cnt.entries()].filter(([id, n]) => n >= 2 && !seen.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => byId.get(id));
  freq.forEach((p) => seen.add(p.id));
  return { recent, freq, seen };
}

/* ----- Добавление еды в дневник ----- */
function openAddFood(mealId, presetProduct) {
  const ov = openSheet(`
    <div class="sheet-head af-head"><select id="af-meal" class="input" aria-label="Приём пищи">${mealOptions(mealId)}</select><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div id="af-body"></div>`);
  ov.classList.add("top");
  const body = $("#af-body", ov);
  let q = "";
  // окно держится у верхнего края видимой области: клавиатура не закрывает результаты поиска
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      if (!ov.isConnected) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); return; }
      ov.style.top = `${vv.offsetTop}px`; ov.style.height = `${vv.height}px`; ov.style.bottom = "auto";
    };
    vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
  }

  function showList() {
    body.classList.add("lm");
    body.innerHTML = `
      <div class="af-btns">
        <button type="button" class="btn primary" id="af-scan">${SCAN_SVG}<span>Скан</span></button>
        <button type="button" class="btn ghost" id="af-new">+ Карточка</button>
        <button type="button" class="btn ghost" id="af-ai">Блюдо (ИИ)</button>
      </div>
      <input id="af-q" class="input search" type="search" placeholder="Найти в общей базе" value="${esc(q)}" autocomplete="off">
      <div id="af-list" class="plist"></div>`;
    const draw = () => {
      if (!q.trim() && state.products.length) {
        const qs = quickProducts();
        const sec = (title, arr) => (arr.length ? `<div class="qa-title">${title}</div>${arr.map((p) => productRow(p, "data-pick")).join("")}` : "");
        const rest = state.products.filter((p) => !qs.seen.has(p.id)).slice(0, 60);
        $("#af-list", ov).innerHTML = sec("Недавнее", qs.recent) + sec("Частое", qs.freq) + ((qs.recent.length || qs.freq.length) && rest.length ? `<div class="qa-title">Все продукты</div>` : "") + rest.map((p) => productRow(p, "data-pick")).join("");
        return;
      }
      const items = filterProducts(q).slice(0, 60);
      $("#af-list", ov).innerHTML = items.length ? items.map((p) => productRow(p, "data-pick")).join("") : (state.products.length ? `<div class="empty"><b>Ничего не найдено</b>Отсканируйте штрих-код или добавьте продукт вручную.</div>` : emptyProducts);
    };
    draw();
    $("#af-q", ov).addEventListener("input", (e) => { q = e.target.value; draw(); });
    $("#af-scan", ov).addEventListener("click", () => openScanner((code) => processBarcode(code, showDetail, showDetail, (id, pre) => { ov.close(); openDrinkSheet(null, id, 0, pre); })));
    $("#af-new", ov).addEventListener("click", () => newCardFlow({ name: q.trim() }, (p) => showDetail(p), (id, pre) => { ov.close(); openDrinkSheet(null, id, 0, pre); }));
    $("#af-ai", ov).addEventListener("click", () => { const meal = $("#af-meal", ov).value; ov.close(); openAiDish(meal); });
    $("#af-list", ov).addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      const p = state.products.find((x) => x.id === b.dataset.pick);
      if (p) showDetail(p);
    });
  }

  async function showOff(term) {
    body.classList.remove("lm");
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
      openProductForm(null, showDetail, { ...d, source: "off", note: OFF_NOTE + drinkNote(d) });
    }));
  }

  function showDetail(p) {
    body.classList.remove("lm");
    const info = p.drink ? { pct: Number(p.hydrationPct) || 0, caf100: Number(p.caffeineMg100) || 0 } : null;
    const last = Number(lsGet(`g:${p.id}`)) || (info ? 250 : 100);
    body.innerHTML = `
      <div class="picked"><div class="p-name">${esc(p.name)}</div><div class="p-sub">${esc(per100Text(p))}</div></div>
      ${info ? `<div class="note">Напиток: засчитается и как еда, и как жидкость${info.caf100 > 0 ? " с кофеином" : ""}. Повторно вносить не нужно.</div>` : ""}
      <label class="field"><span>${info ? "Объём, мл" : "Вес, г"}</span><input id="af-g" class="input big" inputmode="decimal" value="${last}" autocomplete="off"></label>
      <div class="chips">${(info ? [150, 250, 330, 500, 1000] : [50, 100, 150, 200, 250]).map((n) => `<button type="button" class="chip" data-g="${n}">${n}</button>`).join("")}</div>
      <div class="preview" id="af-prev"></div>
      <div class="row"><button type="button" class="btn ghost" id="af-back">Назад</button><button type="button" class="btn primary grow" id="af-add">Добавить</button></div>`;
    const input = $("#af-g", ov);
    const p100 = per100Of(p);
    const upd = () => { $("#af-prev", ov).innerHTML = previewHtml(p100, num(input.value), info); };
    upd();
    input.addEventListener("input", upd);
    input.focus(); input.select();
    body.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = c.dataset.g; upd(); }));
    $("#af-back", ov).addEventListener("click", showList);
    $("#af-add", ov).addEventListener("click", () => {
      const grams = num(input.value);
      if (!(grams > 0)) { toast(info ? "Введите объём в миллилитрах" : "Введите вес в граммах"); return; }
      lsSet(`g:${p.id}`, String(grams));
      const meal = $("#af-meal", ov).value;
      const warn = info ? cafToast((grams * info.caf100) / 100) : "";
      addDoc(colRef("entries"), {
        date: state.date, meal, productId: p.id, name: p.name, brand: p.brand || "",
        grams, per100: p100, ...calc(p100, grams), ...(info ? { drink: info } : {}), createdAt: serverTimestamp(),
      }).catch(writeFail);
      ov.close();
      toast(warn || "Добавлено");
    });
  }

  if (presetProduct) showDetail(presetProduct); else showList();
}

/* ----- Блюдо по описанию или фото (Gemini) ----- */
async function photoToB64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return { mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.8).split(",")[1] };
  } finally { URL.revokeObjectURL(url); }
}
function parseDishJson(text) {
  const t = String(text).replace(/```json|```/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Ответ ИИ не удалось разобрать");
  const j = JSON.parse(t.slice(a, b + 1));
  const n = (v) => Math.max(0, Number(String(v).replace(",", ".")) || 0);
  const grams = n(j.grams);
  if (!(grams > 0) || !(n(j.kcal) >= 0)) throw new Error("ИИ не определил вес или калории блюда");
  return { name: String(j.name || "Блюдо").slice(0, 80), grams, kcal: n(j.kcal), protein: n(j.protein), fat: n(j.fat), carbs: n(j.carbs),
    items: Array.isArray(j.items) ? j.items.slice(0, 15).map((x) => ({ name: String(x.name || ""), grams: n(x.grams) })).filter((x) => x.name) : [], comment: String(j.comment || "") };
}
function openAiDish(mealId) {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Блюдо (ИИ)</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div id="ai-body"></div>`);
  const body = $("#ai-body", ov);
  let photo = null, form = { desc: "", grams: "" };

  function showForm(err) {
    if (!geminiKey()) {
      body.innerHTML = `<div class="banner"><b>Gemini не подключён</b><br><small>Откройте «Отчёты», блок «Анализ с помощью ИИ», и нажмите «Подключить Gemini». Ключ нужен один раз.</small></div>`;
      return;
    }
    body.innerHTML = `
      <p class="foot-note" style="margin:0 2px 10px">Опишите блюдо словами, сделайте фото или то и другое. ИИ оценит вес порции, калории и БЖУ. Это примерная оценка: проверьте и поправьте вес.</p>
      <label class="field"><span>Приём пищи</span><select id="ai-meal" class="input">${mealOptions(mealId)}</select></label>
      <label class="field"><span>Описание</span><textarea id="ai-desc" class="input" rows="3" placeholder="Например: шаурма куриная в лаваше, с овощами и чесночным соусом, большая">${esc(form.desc)}</textarea></label>
      <label class="field"><span>Вес порции, г (если знаете)</span><input id="ai-g" class="input" inputmode="decimal" value="${esc(form.grams)}" autocomplete="off"></label>
      <input type="file" accept="image/*" id="ai-file" class="vh">
      <div class="row"><button type="button" class="btn ghost grow" id="ai-pick">${photo ? "Фото выбрано ✓ (заменить)" : "Добавить фото"}</button>${photo ? `<button type="button" class="btn ghost" id="ai-unphoto">Убрать</button>` : ""}</div>
      ${err ? `<div class="banner" role="alert" style="margin-top:10px"><b>${esc(err)}</b></div>` : ""}
      <button type="button" class="btn primary full" id="ai-go" style="margin-top:12px">Определить состав</button>`;
    const keep = () => { form = { desc: $("#ai-desc", ov).value, grams: $("#ai-g", ov).value }; mealId = $("#ai-meal", ov).value; };
    $("#ai-pick", ov).addEventListener("click", () => $("#ai-file", ov).click());
    $("#ai-file", ov).addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      keep();
      try { photo = await photoToB64(f); } catch { photo = null; showForm("Не удалось прочитать фото"); return; }
      showForm();
    });
    const un = $("#ai-unphoto", ov);
    if (un) un.addEventListener("click", () => { keep(); photo = null; showForm(); });
    $("#ai-go", ov).addEventListener("click", () => {
      keep();
      if (!form.desc.trim() && !photo) { showForm("Опишите блюдо или добавьте фото"); return; }
      run();
    });
  }

  async function run() {
    body.innerHTML = `<div class="empty"><b>Определяю состав…</b><span id="ai-step">Обычно 10–30 секунд.</span></div>`;
    const g = num(form.grams);
    const prompt = `Ты диетолог. Оцени блюдо${photo ? " по фото" : ""}${form.desc.trim() ? ` и описанию: «${form.desc.trim()}»` : ""}.${g > 0 ? ` Вес порции известен: ${g} г.` : " Оцени вес порции в граммах сам."}
Верни ТОЛЬКО JSON без пояснений такого вида:
{"name":"короткое название блюда по-русски","grams":вес порции в граммах числом,"kcal":калории всей порции числом,"protein":белки всей порции в граммах,"fat":жиры всей порции в граммах,"carbs":углеводы всей порции в граммах,"items":[{"name":"ингредиент","grams":число}],"comment":"одна короткая фраза о том, что неточно"}
Числа без единиц. Калории и БЖУ указывай на всю порцию, а не на 100 г. Если не уверен, дай реалистичную среднюю оценку.`;
    try {
      const r = await askGemini(prompt, (t) => { const el = $("#ai-step", ov); if (el) el.textContent = t; }, { image: photo, json: true, lite: true });
      if (!ov.isConnected) return;
      showResult(parseDishJson(r.text), r.model);
    } catch (e) {
      if (!ov.isConnected) return;
      showForm(e.message === "no-key" ? "Gemini не подключён" : `Не получилось: ${e.message}`);
    }
  }

  function showResult(d, model) {
    const p100 = { kcal: (d.kcal / d.grams) * 100, protein: (d.protein / d.grams) * 100, fat: (d.fat / d.grams) * 100, carbs: (d.carbs / d.grams) * 100 };
    body.innerHTML = `
      <label class="field"><span>Название</span><input id="ai-name" class="input" maxlength="80" value="${esc(d.name)}" autocomplete="off"></label>
      <label class="field"><span>Вес порции, г</span><input id="ai-w" class="input big" inputmode="decimal" value="${Math.round(d.grams)}" autocomplete="off"></label>
      <div class="preview" id="ai-prev"></div>
      ${d.items.length ? `<p class="foot-note" style="margin:8px 2px">Состав по оценке ИИ: ${d.items.map((x) => `${esc(x.name)}${x.grams > 0 ? ` ${fmt(x.grams)} г` : ""}`).join(", ")}.</p>` : ""}
      ${d.comment ? `<p class="foot-note" style="margin:0 2px 8px">${esc(d.comment)}</p>` : ""}
      <p class="foot-note" style="margin:0 2px 10px">Примерная оценка (${esc(model)}). КБЖУ пересчитывается при изменении веса.</p>
      <label class="field"><span>Приём пищи</span><select id="ai-meal2" class="input">${mealOptions(mealId)}</select></label>
      <div class="row"><button type="button" class="btn ghost" id="ai-back">Назад</button><button type="button" class="btn primary grow" id="ai-add">Добавить</button></div>`;
    const w = $("#ai-w", ov);
    const upd = () => { $("#ai-prev", ov).innerHTML = previewHtml(p100, num(w.value), null); };
    upd();
    w.addEventListener("input", upd);
    $("#ai-back", ov).addEventListener("click", () => showForm());
    $("#ai-add", ov).addEventListener("click", () => {
      const grams = num(w.value);
      if (!(grams > 0)) { return; }
      const name = $("#ai-name", ov).value.trim() || "Блюдо";
      addDoc(colRef("entries"), {
        date: state.date, meal: $("#ai-meal2", ov).value, productId: `ai:${fnv(fold(name))}`, name, brand: "Оценка ИИ",
        grams, per100: p100, ...calc(p100, grams), createdAt: serverTimestamp(),
      }).catch(writeFail);
      ov.close();
    });
  }

  showForm();
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
    <label class="field"><span>${entry.drink ? "Объём, мл" : "Вес, г"}</span><input id="ee-g" class="input big" inputmode="decimal" value="${String(entry.grams).replace(".", ",")}" autocomplete="off"></label>
    <div class="preview" id="ee-prev"></div>
    <div class="row"><button type="button" class="btn danger" id="ee-del">Удалить</button><button type="button" class="btn primary grow" id="ee-save">Сохранить</button></div>`);
  const input = $("#ee-g", ov);
  const oldCaf = entry.drink ? (Number(entry.grams) * Number(entry.drink.caf100)) / 100 : 0;
  const upd = () => { $("#ee-prev", ov).innerHTML = previewHtml(p100, num(input.value), entry.drink || null, oldCaf); };
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
  const drinkBlock = product && !ro
    ? `${product.drink ? `<div class="note">Этот продукт отмечен как напиток (гидратация ${esc(val(product.hydrationPct))}%). Напитки теперь живут в своём списке: перенесите его туда.</div>` : ""}
      <button type="button" class="btn soft full" id="pf-todrink" style="margin:4px 0 12px">Это напиток: перенести в напитки</button>`
    : "";
  const ov = openSheet(`
    <div class="sheet-head"><h2>${product ? "Продукт" : "Новый продукт"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    ${product ? `<button type="button" class="btn ghost full" id="pf-usage" style="margin-bottom:12px">Когда я это ел: даты, граммы, калории</button>` : ""}
    <label class="field"><span>Название</span><input id="pf-name" class="input" maxlength="120" ${dis} value="${esc(p.name)}" autocomplete="off" placeholder="Например, Картофель варёный"></label>
    <label class="field"><span>Бренд (необязательно)</span><input id="pf-brand" class="input" maxlength="80" ${dis} value="${esc(p.brand || "")}" autocomplete="off"></label>
    <div class="field"><span>Штрих-код (необязательно)</span>${barcodeField}</div>
    ${product ? `<div class="field" id="pf-alias"><span>Другие упаковки: ещё штрих-коды этого продукта</span>
      <div id="pf-alias-list" class="chips"></div>
      <div class="inline"><input id="pf-alias-in" class="input" inputmode="numeric" maxlength="20" placeholder="Штрих-код другой упаковки" autocomplete="off"><button type="button" class="icon-btn" id="pf-alias-scan" aria-label="Сканировать штрих-код">${SCAN_SVG}</button><button type="button" class="btn ghost sm" id="pf-alias-add">Добавить</button></div>
      <p class="foot-note" id="pf-alias-msg" style="margin:6px 2px 0">Коды общие: любой пользователь, отсканировав эту упаковку, получит этот продукт. Убрать код может тот, кто его добавил.</p></div>` : ""}
    <div class="field"><span>Значения на 100 г</span></div>
    <div class="field-grid">
      <label class="field"><span>Калории, ккал</span><input id="pf-kcal" class="input" inputmode="decimal" ${dis} value="${val(p.kcal)}" autocomplete="off"></label>
      <label class="field"><span>Белки, г</span><input id="pf-protein" class="input" inputmode="decimal" ${dis} value="${val(p.protein)}" autocomplete="off"></label>
      <label class="field"><span>Жиры, г</span><input id="pf-fat" class="input" inputmode="decimal" ${dis} value="${val(p.fat)}" autocomplete="off"></label>
      <label class="field"><span>Углеводы, г</span><input id="pf-carbs" class="input" inputmode="decimal" ${dis} value="${val(p.carbs)}" autocomplete="off"></label>
    </div>
    ${drinkBlock}
    <div class="row">${ro
      ? `<button type="button" class="btn ghost full" data-close>Закрыть</button>`
      : `${product ? `<button type="button" class="btn danger" id="pf-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="pf-save">Сохранить</button>`}</div>`);

  if (product) $("#pf-usage", ov).addEventListener("click", () => openProductUsage(product));
  if (product) {
    const list = $("#pf-alias-list", ov), msg = $("#pf-alias-msg", ov), inp = $("#pf-alias-in", ov);
    const drawAliases = () => {
      const codes = aliasCodes(product.id);
      list.innerHTML = codes.length ? codes.map((c) => `<span class="chip alias">${esc(c)}${state.bcOwner[c] === uid ? `<button type="button" class="alias-x" data-del="${esc(c)}" aria-label="Убрать код">×</button>` : ""}</span>`).join("") : "";
    };
    drawAliases();
    const add = (raw) => {
      const code = String(raw || "").replace(/\D/g, "");
      if (code.length < 6) { msg.textContent = "Введите штрих-код полностью (цифры)."; return; }
      const k = normBC(code);
      if (k === normBC(product.barcode)) { msg.textContent = "Это уже основной штрих-код продукта."; return; }
      const other = findByBarcode(code);
      if (other && other.id !== product.id) { msg.textContent = `Этот код уже привязан к продукту «${other.name}».`; return; }
      const cf = bcConflict(code, { productId: product.id });
      if (cf) { msg.textContent = cf; return; }
      linkBarcode(code, product.id);
      inp.value = "";
      msg.textContent = "Код добавлен. Теперь при сканировании этой упаковки продукт найдётся сразу.";
      drawAliases();
    };
    $("#pf-alias-add", ov).addEventListener("click", () => add(inp.value));
    $("#pf-alias-scan", ov).addEventListener("click", () => openScanner((code) => add(code)));
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-del]");
      if (!b) return;
      unlinkBarcode(b.dataset.del);
      drawAliases();
    });
  }
  if (ro) return;

  const todrink = $("#pf-todrink", ov);
  if (todrink) todrink.addEventListener("click", () => {
    const codes = [product.barcode, ...aliasCodes(product.id)].filter(Boolean);
    const uniq = []; codes.forEach((c) => { if (!uniq.some((x) => normBC(x) === normBC(c))) uniq.push(c); });
    ov.close();
    openDrinkSheet(null, null, 0, { card: true, from: product, n: product.name, k: Number(product.kcal) || 0, p: Number(product.protein) || 0, f: Number(product.fat) || 0, cb: Number(product.carbs) || 0,
      h: product.drink ? Number(product.hydrationPct) : 90, c: product.drink ? r1((Number(product.caffeineMg100) || 0) * 2.4) : 0, cat: "other", bc: uniq });
  });

  $("#pf-scan", ov).addEventListener("click", () => openScanner(async (code) => {
    $("#pf-barcode", ov).value = code;
    const dup = bcConflict(code, { productId: product && product.id });
    if (dup) { toast(dup); return; }
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
      const dup = bcConflict(barcode, { productId: product && product.id });
      if (dup) { toast(dup); return; }
    }
    // Новые продукты не бывают напитками; у старых напитков-продуктов поля сохраняются, пока их не перенесли в напитки
    const drinkData = product && product.drink
      ? { drink: true, hydrationPct: Number(product.hydrationPct) || 0, caffeineMg100: Number(product.caffeineMg100) || 0 }
      : { drink: false, hydrationPct: 0, caffeineMg100: 0 };
    const data = { name, brand, barcode, kcal, protein, fat, carbs, ...drinkData, updatedAt: serverTimestamp() };
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
// План: цели калорий и БЖУ всегда совпадают с дневной целью (state.goal); calcKcal хранит чистый расчёт по профилю
const currentPlan = () => {
  const p = computePlan(state.profile);
  if (!p) return p;
  const mg = macroGoals(), hasGoal = Number(state.profile.goalKcal) > 0;
  return { ...p, calcKcal: p.kcal, kcal: hasGoal ? Math.round(state.goal) : p.kcal, ...(mg ? { protein: Math.round(mg.protein), fat: Math.round(mg.fat), carbs: Math.round(mg.carbs) } : {}) };
};
const waterOn = (d) => (byDateIndex("water").get(d) || EMPTY).reduce((sum, x) => sum + (Number(x.ml) || 0), 0);
const actOn = (d) => byDateIndex("activity").get(d) || EMPTY;
// Данные из Apple Health: итоги дня (шаги, активные ккал, пульс) и тренировки с часов
const healthOn = (d) => (byDateIndex("health").get(d) || EMPTY)[0] || null;
const workoutsOn = (d) => (byDateIndex("workouts").get(d) || EMPTY);
// Сон: итоги ночи хранятся в health/{день пробуждения}: sleepH, sleepDeepH, sleepRemH, sleepCoreH, sleepAwakeH, sleepInBedH, sleepStart, sleepEnd
const sleepOn = (d) => { const h = healthOn(d); return h && Number(h.sleepH) > 0 ? h : null; };
const sleepHours = (d) => { const h = sleepOn(d); return h ? Number(h.sleepH) : 0; };
const fmtDur = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин`; };
const bedMin = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(s || ""); if (!m) return null; let v = +m[1] * 60 + +m[2]; if (v < 12 * 60) v += 1440; return v; };
const minToClock = (v) => { v = ((Math.round(v) % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };
const SLEEP_MIN = 7, SLEEP_MAX = 9;
const stepsOn = (d) => { const h = healthOn(d); return h && Number(h.steps) > 0 ? Number(h.steps) : 0; };
const wkMinutes = (d) => workoutsOn(d).reduce((sum, w) => sum + (Number(w.minutes) || 0), 0);
const wkKcal = (d) => workoutsOn(d).reduce((sum, w) => sum + (Number(w.kcal) || 0), 0);
// Нагрузка дня: записи вручную + тренировки с часов. Активные ккал часов уже включают тренировки, поэтому берём большее
const actMinutes = (d) => actOn(d).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0) + wkMinutes(d);
const actBurned = (d) => {
  const h = healthOn(d);
  return actOn(d).reduce((sum, a) => sum + (Number(a.kcal) || 0), 0) + Math.max(h ? Number(h.activeKcal) || 0 : 0, wkKcal(d));
};
const STEPS_GOAL = 8000;
// Силовая ли тренировка: ручная отметка (strength true/false) главнее, иначе определяем по названию с часов
const STRENGTH_RE = /силов|strength|функциональн|functional|кроссфит|crossfit/i;
const isStrengthW = (w) => (typeof w.strength === "boolean" ? w.strength : STRENGTH_RE.test(String(w.name || "")));
const timeOf = (ts) => { try { const dt = ts && ts.toDate ? ts.toDate() : ts && ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts); return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const waterBase = () => (Number(state.profile.waterBaseMl) > 0 ? Number(state.profile.waterBaseMl) : 2000);
// Норма воды растёт с нагрузкой: примерно 500 мл на час тренировки
const waterTarget = (d) => Math.round((waterBase() + actMinutes(d) * 8) / 50) * 50;
const userWeight = () => (Number(state.profile.weightKg) > 0 ? Number(state.profile.weightKg) : 70);
const weekDays = (s) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i));

/* ----- Жидкость и кофеин: напитки из списка и напитки, добавленные как еда ----- */
const numS = (v) => { const n = parseFloat(String(v).trim().replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const signed = (n) => `${n < 0 ? "−" : "+"}${fmtInt(Math.abs(n))}`;
// Нормы EFSA для здоровых взрослых: до 5,7 мг/кг в сутки (не больше 400 мг) и до 3 мг/кг за раз (не больше 200 мг)
const cafLimit = () => Math.round(Math.min(400, 5.7 * userWeight()));
const cafDose = () => Math.round(Math.min(200, 3 * userWeight()));

function fluidItems(day) {
  const items = [];
  (byDateIndex("drinks").get(day) || EMPTY).forEach((x) => items.push({
    kind: "drink", id: x.id, drinkId: x.drinkId, name: x.name, ml: Number(x.ml) || 0, pct: Number(x.pct) || 0, caf100: Number(x.caf100) || 0, ts: createdMs(x),
  }));
  entriesOn(day).filter((e) => e.drink).forEach((e) => items.push({
    kind: "food", id: e.id, name: e.name, ml: Number(e.grams) || 0, pct: Number(e.drink.pct) || 0, caf100: Number(e.drink.caf100) || 0, kcal: Number(e.kcal) || 0, ts: createdMs(e),
  }));
  return items.sort((a, b) => a.ts - b.ts);
}
const itemHyd = (i) => (i.ml * i.pct) / 100;
const itemCaf = (i) => (i.ml * i.caf100) / 100;
const hydrationOn = (d) => Math.round(waterOn(d) + fluidItems(d).reduce((sum, i) => sum + itemHyd(i), 0));
const caffeineOn = (d) => fluidItems(d).reduce((sum, i) => sum + itemCaf(i), 0);

function caffeineStatus(day) {
  const mg = Math.round(caffeineOn(day)), limit = cafLimit(), ratio = limit ? mg / limit : 0;
  const items = fluidItems(day).filter((i) => itemCaf(i) > 0);
  const msgs = [];
  if (ratio >= 1) msgs.push({ lv: "over", t: `Превышена суточная норма кофеина: ${mg} из ${limit} мг.` });
  else if (ratio >= 0.8) msgs.push({ lv: "warn", t: `Вы близки к суточной норме кофеина: ${mg} из ${limit} мг.` });
  items.filter((i) => itemCaf(i) > cafDose()).forEach((i) => msgs.push({ lv: "warn", t: `${i.name}: ${fmtInt(itemCaf(i))} мг кофеина в одной порции, это больше разовой нормы ${cafDose()} мг.` }));
  if (day === todayStr() && items.some((i) => new Date(i.ts).getHours() >= 16)) msgs.push({ lv: "info", t: "Кофеин после 16:00 может ухудшить сон: старайтесь не пить его за 6 часов до сна." });
  return { mg, limit, ratio, level: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok", msgs };
}

// Предупреждения для напитка, который вот-вот добавят (replaceMg: кофеин записи, которую заменяют при правке)
function cafWarnings(addMg, replaceMg = 0) {
  const total = caffeineOn(state.date) - replaceMg + addMg, limit = cafLimit(), out = [];
  if (addMg > cafDose()) out.push({ lv: "warn", t: `В порции ${fmtInt(addMg)} мг кофеина: это больше разовой нормы ${cafDose()} мг.` });
  if (total >= limit) out.push({ lv: "over", t: `С этим напитком будет ${fmtInt(total)} мг: выше суточной нормы ${limit} мг.` });
  else if (total >= limit * 0.8) out.push({ lv: "warn", t: `С этим напитком будет ${fmtInt(total)} из ${limit} мг: вы близки к суточной норме.` });
  if (addMg > 0 && state.date === todayStr() && new Date().getHours() >= 16) out.push({ lv: "info", t: "Кофеин вечером может ухудшить сон." });
  return out;
}
const cafWarnHtml = (addMg, replaceMg = 0) => cafWarnings(addMg, replaceMg).map((w) => `<div class="warn ${w.lv === "over" ? "over" : ""}">${esc(w.t)}</div>`).join("");
const cafToast = (addMg, replaceMg = 0) => { const w = cafWarnings(addMg, replaceMg).filter((x) => x.lv !== "info"); return w.length ? w[0].t : ""; };

// Свои напитки пользователя (хранятся в settings/drinks, поле custom) складываются со справочником
const shapeDrink = (x, mine, by) => ({ id: x.id, n: x.n, h: Number(x.h), c: Number(x.c) || 0, cat: x.cat || "other", a: x.a || "", k: Number(x.k) || 0, p: Number(x.p) || 0, f: Number(x.f) || 0, cb: Number(x.cb) || 0, bc: Array.isArray(x.bc) ? x.bc : [], mine, by: by || "" });
const customList = () => {
  const uid = state.user && state.user.uid;
  const shared = (state.sharedDrinks || []).map((x) => shapeDrink(x, !!uid && x.createdBy === uid, x.createdByName)).sort((p, q) => String(p.n).localeCompare(String(q.n), "ru"));
  const ids = new Set(shared.map((x) => x.id));
  // Личные напитки старой версии, пока не перенесены в общую базу
  const legacy = (state.customDrinks || []).filter((x) => !ids.has(x.id)).map((x) => shapeDrink(x, true, ""));
  return [...shared, ...legacy];
};
// Общая база напитков (drinkdb): запись и удаление карточек
const drinkData = (it, existingCreatedAt) => ({
  n: String(it.n).slice(0, 120), h: Number(it.h) || 0, c: Number(it.c) || 0, cat: String(it.cat || "other").slice(0, 20), a: String(it.a || "").slice(0, 40),
  k: Number(it.k) || 0, p: Number(it.p) || 0, f: Number(it.f) || 0, cb: Number(it.cb) || 0, bc: (Array.isArray(it.bc) ? it.bc : []).filter(Boolean).slice(0, 12).map(String),
  ...authorFields(), createdAt: existingCreatedAt || serverTimestamp(), updatedAt: serverTimestamp(),
});
const saveSharedDrink = (it) => {
  const cur = (state.sharedDrinks || []).find((x) => x.id === it.id);
  if (cur && cur.createdBy !== state.user.uid) { toast("Менять карточку может только её автор"); return Promise.resolve(); }
  return setDoc(doc(db, "drinkdb", it.id), drinkData(it, cur && cur.createdAt)).catch(writeFail);
};
const deleteSharedDrink = (id) => deleteDoc(doc(db, "drinkdb", id)).catch(writeFail);
const newDrinkId = () => "u" + Date.now().toString(36) + state.user.uid.slice(0, 3).toLowerCase();
// Один раз переносит личные напитки в общую базу (повторы по названию не добавляются, избранное переносится на уже существующий)
async function maybeMigrateDrinks() {
  if (!state.drinkdbReady || !state.drinkSetReady || !state.user || state.drinkMigrated === state.user.uid) return;
  if (!state.customDrinks.length) return;
  state.drinkMigrated = state.user.uid;
  try {
    const have = new Map((state.sharedDrinks || []).map((x) => [fold(x.n), x.id]));
    const fav = state.fav.slice();
    for (const x of state.customDrinks) {
      const key = fold(x.n);
      if (have.has(key)) {
        const to = have.get(key), k = fav.indexOf(x.id);
        if (k >= 0 && to !== x.id) fav[k] = to;
        continue;
      }
      if (state.sharedDrinks.some((s) => s.id === x.id)) continue;
      await setDoc(doc(db, "drinkdb", x.id), drinkData(shapeDrink(x, true))).catch((e) => console.warn("Перенос напитка", x.n, e));
      have.set(key, x.id);
    }
    await setDoc(doc(db, "users", state.user.uid, "settings", "drinks"), { custom: [], fav: [...new Set(fav)] }, { merge: true });
  } catch (e) { state.drinkMigrated = null; console.warn("Перенос напитков в общую базу:", e); }
}
// Штрих-коды напитков хранятся в карточке напитка (bc). Один код не может быть одновременно у напитка и у продукта
const findDrinkByBarcode = (code) => {
  const k = normBC(code);
  return k ? customList().find((d) => d.bc.some((b) => normBC(b) === k)) || null : null;
};
const bcConflict = (code, ig = {}) => {
  const p = findByBarcode(code);
  if (p && p.id !== ig.productId) return `Этот штрих-код уже есть среди продуктов: ${p.name}`;
  const dr = findDrinkByBarcode(code);
  if (dr && dr.id !== ig.drinkId) return `Этот штрих-код уже есть среди напитков: ${dr.n}`;
  return "";
};
const saveCustomDrinks = (extra = {}) => setDoc(doc(db, "users", state.user.uid, "settings", "drinks"), { custom: state.customDrinks, ...extra }, { merge: true }).catch(writeFail);
const allDrinks = () => [...DRINKS, ...customList()];
const drinkById = (id) => DRINK_BY_ID[id] || customList().find((x) => x.id === id) || null;
function favDrinks() {
  const counts = {};
  state.drinks.forEach((x) => { if (x.drinkId && x.drinkId !== "custom" && x.drinkId !== "water" && drinkById(x.drinkId)) counts[x.drinkId] = (counts[x.drinkId] || 0) + 1; });
  const freq = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return [...state.fav, ...freq.filter((id) => !state.fav.includes(id))].slice(0, 8).map((id) => drinkById(id)).filter(Boolean);
}


const dayNavButtons = (day) => `
  <button type="button" class="iconbtn" data-act="prevDay" aria-label="Предыдущий день" ${day <= FLOOR_DATE ? "disabled" : ""}>${CHEV_L}</button>
  <button type="button" class="chip-btn" data-act="today">${dateShort(day)}</button>
  <button type="button" class="iconbtn" data-act="nextDay" aria-label="Следующий день">${CHEV_R}</button>`;

const fillProfilePrompt = `<section class="card">
  <h2 class="h2">Настройте план</h2>
  <p class="foot-note" style="margin:0 0 12px">Укажите пол, возраст, рост, вес и цель: приложение рассчитает калории, БЖУ, норму воды и рекомендации по нагрузке.</p>
  <button type="button" class="btn primary full" data-act="openProfile">Заполнить данные</button>
</section>`;

// Две плитки в дневнике: жидкость (с кофеином) и нагрузка за выбранный день
function miniTiles(day) {
  const ml = hydrationOn(day), tg = waterTarget(day);
  const mins = actMinutes(day), burned = actBurned(day);
  const plan = currentPlan();
  const dayGoal = plan ? Math.ceil(plan.weekly.minutes / 7) : 30;
  const caf = caffeineStatus(day);
  const banner = caf.level !== "ok" ? `<div class="warn ${caf.level === "over" ? "over" : ""}" style="margin:0 0 12px">${esc(caf.msgs[0].t)}</div>` : "";
  return `<div class="mini-row">
    <button type="button" class="mini water" data-act="goTab" data-tab="health" data-h="today">
      <span class="mini-top"><span class="mini-ic">${DROP_SVG}</span><span class="mini-label">Жидкость</span></span>
      <span class="mini-val">${fmtInt(ml)}<small>мл</small></span>
      <span class="mini-sub">норма ${fmtInt(tg)} мл</span>
      ${caf.mg > 0 ? `<span class="mini-sub caf ${caf.level}">кофеин ${caf.mg} из ${caf.limit} мг</span>` : ""}
      <span class="mini-bar"><i style="width:${Math.max(0, Math.min(100, (ml / tg) * 100))}%"></i></span>
    </button>
    <button type="button" class="mini act" data-act="goTab" data-tab="health" data-h="train">
      <span class="mini-top"><span class="mini-ic">${PULSE_SVG}</span><span class="mini-label">Нагрузка</span></span>
      <span class="mini-val">${fmtInt(mins)}<small>мин</small></span>
      <span class="mini-sub">сожжено ${fmtInt(burned)} ккал</span>
      ${stepsOn(day) ? `<span class="mini-sub">${fmtInt(stepsOn(day))} шагов</span>` : ""}
      <span class="mini-bar"><i style="width:${Math.min(100, (mins / dayGoal) * 100)}%"></i></span>
    </button>
  </div>${banner}`;
}

function viewHealth() {
  const day = state.date;
  const plan = currentPlan();
  const ml = hydrationOn(day), tg = waterTarget(day);
  const extra = actMinutes(day) * 8;
  const left = tg - ml;
  const items = fluidItems(day);
  const isW = (i) => i.kind === "drink" && isWaterDrink(i);
  const wMl = waterOn(day) + items.filter(isW).reduce((sum, i) => sum + itemHyd(i), 0);
  const dHyd = items.filter((i) => i.kind === "drink" && !isW(i)).reduce((sum, i) => sum + itemHyd(i), 0);
  const fHyd = items.filter((i) => i.kind === "food").reduce((sum, i) => sum + itemHyd(i), 0);
  const parts = [];
  if (wMl) parts.push(`вода ${fmtInt(wMl)} мл`);
  if (Math.round(dHyd)) parts.push(`напитки ${signed(Math.round(dHyd))} мл`);
  if (Math.round(fHyd)) parts.push(`напитки из дневника питания ${signed(Math.round(fHyd))} мл`);
  const caf = caffeineStatus(day);
  const acts = actOn(day).sort((a, b) => createdMs(a) - createdMs(b));
  const mins = actMinutes(day), burned = actBurned(day);
  const trainKcal = actOn(day).reduce((t, a) => t + (Number(a.kcal) || 0), 0) + wkKcal(day);
  const hd = healthOn(day), wkts = workoutsOn(day).slice().sort((x, y) => (x.start && x.start.seconds || 0) - (y.start && y.start.seconds || 0));
  const steps = stepsOn(day);
  const wk = weekDays(day);
  const wkMin = wk.reduce((sum, d) => sum + actMinutes(d), 0);
  const wkStepsDays = wk.filter((d) => stepsOn(d) > 0);
  const wkStepsAvg = wkStepsDays.length ? wkStepsDays.reduce((sum, d) => sum + stepsOn(d), 0) / wkStepsDays.length : 0;
  const wkStr = wk.reduce((sum, d) => sum + actOn(d).filter((a) => a.type === "strength").length + workoutsOn(d).filter(isStrengthW).length, 0);
  const wt = plan ? plan.weekly : { minutes: 150, strength: 2, text: WEEKLY.maintain.text };
  const favs = favDrinks();
  const actRows = acts.map((a) => `
    <button type="button" class="entry" data-act="editActivity" data-id="${esc(a.id)}">
      <span class="e-main"><span class="e-name">${esc(a.name)}</span><span class="e-sub">${fmt(a.minutes)} мин</span></span>
      <span class="e-kcal">${fmtInt(a.kcal)}<small>ккал</small></span>
    </button>`).join("");
  const wktRows = wkts.map((w) => {
    const bits = [timeOf(w.start), w.minutes ? `${fmtInt(w.minutes)} мин` : "", w.distanceKm ? `${fmt(w.distanceKm)} км` : "", w.hrAvg ? `пульс ${fmtInt(w.hrAvg)}${w.hrMax ? ` (макс ${fmtInt(w.hrMax)})` : ""}` : ""].filter(Boolean);
    const st = isStrengthW(w);
    return `<div class="entry"><span class="e-main"><span class="e-name">${esc(w.name)}</span><span class="e-sub">${bits.join(" · ")} · Apple Watch</span><button type="button" class="chip ${st ? "sel" : "muted"}" style="margin-top:8px;padding:5px 12px;font-size:12px" data-act="toggleStrength" data-id="${esc(w.id)}">${st ? "Силовая ✓" : "Отметить силовой"}</button></span><span class="e-kcal">${w.kcal ? fmtInt(w.kcal) : "—"}<small>ккал</small></span></div>`;
  }).join("");
  // Сначала самые свежие; по умолчанию видны два последних, остальные раскрываются кнопкой
  const FLUID_SHOW = 2;
  const fluidOpen = state.fluidOpenDay === day;
  const fluidSorted = items.slice().reverse();
  const fluidShown = fluidOpen ? fluidSorted : fluidSorted.slice(0, FLUID_SHOW);
  // Вода, записанная раньше суммой за день (до появления истории)
  const legacyRow = waterOn(day) > 0 ? `<div class="entry"><span class="e-main"><span class="e-name">Вода</span><span class="e-sub">${fmt(waterOn(day))} мл, записано суммой за день</span></span><span class="e-kcal">—<small>мг кофеина</small></span></div>` : "";
  const fluidMore = fluidSorted.length > FLUID_SHOW
    ? `<button type="button" class="more-btn" data-act="toggleFluid">${fluidOpen ? "Свернуть" : `Ещё ${fluidSorted.length - FLUID_SHOW}`}</button>`
    : "";
  const fluidRows = fluidShown.map((i) => `
    <button type="button" class="entry" data-act="editFluid" data-kind="${i.kind}" data-id="${esc(i.id)}">
      <span class="e-main"><span class="e-name">${esc(i.name)}</span><span class="e-sub">${timeOf(i.ts)} · ${fmt(i.ml)} мл${Math.round(i.pct) !== 100 ? ` · гидратация ${fmt(i.pct)}% · засчитано ${signed(Math.round(itemHyd(i)))} мл` : ""}${i.kind === "food" ? " · из дневника питания" : ""}</span></span>
      <span class="e-kcal">${itemCaf(i) > 0 ? fmtInt(itemCaf(i)) : "—"}<small>мг кофеина</small></span>
    </button>`).join("");
  const tab = state.hTab || "today";
  const tabs = `<div class="seg full htabs" data-seg="htab">${[["today", "Жидкость"], ["train", "Тренировки"], ["sleep", "Сон"], ["dyn", "Динамика"]].map(([v, t]) => `<button type="button" data-act="healthTab" data-v="${v}" class="${tab === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
  const pToday = `
    <section class="card">
      <div class="card-top"><h2 class="h2">Жидкость</h2><span class="pill">норма ${fmtInt(tg)} мл</span></div>
      <div class="big-line">${fmtInt(ml)}<small>мл засчитано</small></div>
      <div class="track water"><i style="width:${Math.max(0, Math.min(100, (ml / tg) * 100))}%"></i></div>
      <p class="foot-note" style="margin:10px 0 12px">${left > 0 ? `Осталось ${fmtInt(left)} мл.` : "Норма на сегодня выполнена."}${` Норма сегодня ${fmtInt(tg)} мл = база ${fmtInt(waterBase())} мл${extra ? ` + нагрузка около ${fmtInt(extra)} мл` : ""}.`}${parts.length ? ` Засчитано: ${parts.join(", ")}.` : ""}</p>
      <div class="chips">
        ${[150, 250, 330, 500].map((n) => `<button type="button" class="chip water" data-act="addWater" data-ml="${n}">+${n}</button>`).join("")}
        <button type="button" class="chip" data-act="waterCustom">Другое</button>
        <button type="button" class="chip muted" data-act="addWater" data-ml="-250">−250</button>
      </div>
      <button type="button" class="btn primary full" data-act="addDrink">+ Напиток</button>
      ${favs.length ? `<p class="foot-note" style="margin:14px 2px 8px">Избранное и частые напитки</p><div class="chips" style="margin:0">${favs.map((d) => `<button type="button" class="chip" data-act="quickDrink" data-did="${d.id}">${esc(d.n)}</button>`).join("")}</div>` : ""}
      ${fluidRows || legacyRow ? `<div class="entries flat">${fluidRows}${fluidOpen || fluidSorted.length <= FLUID_SHOW ? legacyRow : ""}</div>${fluidMore}` : ""}
      <div class="caf-card lv-${caf.level}">
        <div class="caf-top"><span class="caf-t">Кофеин</span><span class="caf-val"><b>${fmtInt(caf.mg)}</b> из ${fmtInt(caf.limit)} мг</span></div>
        <div class="caf-bar"><i style="width:${Math.min(100, caf.ratio * 100)}%"></i></div>
        ${caf.msgs.length ? `<ul class="caf-msgs">${caf.msgs.map((m) => `<li class="${m.lv === "over" ? "over" : ""}">${esc(m.t)}</li>`).join("")}</ul>` : ""}
        <button type="button" class="caf-more" data-act="toggleCafInfo">${state.cafInfo ? "Скрыть" : "О норме кофеина"}</button>
        ${state.cafInfo ? `<p class="caf-info">Норма для вашего веса (${fmt(userWeight())} кг): до ${caf.limit} мг в сутки и до ${cafDose()} мг за один раз. Это ориентир EFSA для здоровых взрослых. При беременности и кормлении, а также при болезнях сердца или давлении норма ниже, уточните у врача.</p>` : ""}
      </div>
    </section>`;
  const pTrain = `
    <section class="card">
      <div class="card-top"><h2 class="h2">Активность</h2><span class="pill">${hd ? "Apple Health" : "нет данных с часов"}</span></div>
      ${hd ? `<div class="big-line">${fmtInt(steps)}<small>шагов</small></div>
      <div class="track"><i style="width:${Math.min(100, (steps / STEPS_GOAL) * 100)}%"></i></div>
      <p class="foot-note" style="margin:10px 0 12px">Ориентир ${fmtInt(STEPS_GOAL)} шагов в день.${hd.updatedAt ? ` Обновлено в ${timeOf(hd.updatedAt)}.` : ""}</p>
      <div class="stat-grid">
        <div class="stat"><b>${hd.activeKcal ? fmtInt(hd.activeKcal) : "—"}</b><span>активных ккал</span></div>
        <div class="stat"><b>${hd.restKcal ? fmtInt(hd.restKcal) : "—"}</b><span>энергия покоя, ккал${hd.restKcal ? "" : "<br>данных пока нет"}</span></div>
        <div class="stat"><b>${hd.restKcal || hd.activeKcal ? fmtInt((Number(hd.restKcal) || 0) + (Number(hd.activeKcal) || 0)) : "—"}</b><span>всего потрачено, ккал${hd.restKcal ? "" : "<br>без энергии покоя"}</span></div>
        <div class="stat"><b>${hd.hrAvg ? fmtInt(hd.hrAvg) : "—"}</b><span>средний пульс${hd.hrMin && hd.hrMax ? `<br>от ${fmtInt(hd.hrMin)} до ${fmtInt(hd.hrMax)}` : ""}</span></div>
        <div class="stat"><b>${hd.restingHr ? fmtInt(hd.restingHr) : "—"}</b><span>пульс в покое</span></div>
        <div class="stat"><b>${fmtInt(wkStepsAvg)}</b><span>шагов в день за неделю</span></div>
      </div>` : `<p class="foot-note" style="margin:12px 0 0">За этот день данных с часов нет. Они приходят из Apple Health через Health Auto Export примерно каждые 15 минут, пока открыто это приложение или телефон на связи.</p>`}
    </section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Тренировки</h2><button type="button" class="btn ghost sm" data-act="addActivity">+ Добавить</button></div>
      <div class="stat-grid">
        <div class="stat"><b>${fmtInt(mins)}</b><span>минут за день</span></div>
        <div class="stat"><b>${fmtInt(trainKcal)}</b><span>ккал на тренировках</span></div>
      </div>
      ${actRows || wktRows ? `<div class="entries flat">${wktRows}${actRows}</div>` : `<p class="foot-note" style="margin:12px 4px 0">Пока нет записей. Тренировки с часов появятся сами, а прогулку или любую другую нагрузку можно добавить вручную.</p>`}
    </section>
    ${trainCardHtml(day)}
    ${trainProgressCardHtml()}
    <section class="card">
      <div class="card-top"><h2 class="h2">Неделя</h2><span class="pill">${fmtInt(wkMin)} из ${wt.minutes} мин</span></div>
      <div class="track"><i style="width:${Math.min(100, (wkMin / wt.minutes) * 100)}%"></i></div>
      <p class="foot-note" style="margin:12px 0 0">Силовых тренировок: <b>${wkStr}</b> из ${wt.strength}. ${esc(wt.text)}</p>
    </section>`;
  // ----- Сон -----
  const sl = sleepOn(day);
  const nights = wk.filter((d) => sleepHours(d) > 0);
  const nAvg = nights.length ? nights.reduce((t, d) => t + sleepHours(d), 0) / nights.length : 0;
  let pSleep;
  if (!sl) {
    pSleep = `<section class="card">
      <div class="card-top"><h2 class="h2">Сон</h2><span class="pill">нет данных</span></div>
      <p class="foot-note" style="margin:12px 0 0">За ночь на ${esc(shortDate(day))} данных нет. Сон приходит из Apple Health через Health Auto Export: в автоматизации добавьте метрику «Sleep Analysis» (вид «Aggregated») и обновите Worker. Данные появляются после пробуждения, когда часы или телефон закончат запись сна.</p>
    </section>${nights.length ? barsCard("Сон за неделю", wk, (d) => Math.round(sleepHours(d) * 10) / 10, () => SLEEP_MIN, "ч", "sleep", false, (v) => fmt(v)) : ""}`;
  } else {
    const tot = Number(sl.sleepH), deep = Number(sl.sleepDeepH) || 0, rem = Number(sl.sleepRemH) || 0, core = Number(sl.sleepCoreH) || 0, awake = Number(sl.sleepAwakeH) || 0, inBed = Number(sl.sleepInBedH) || (tot + awake);
    const lv = tot < 6 ? "bad" : tot < SLEEP_MIN ? "warn" : tot <= SLEEP_MAX ? "good" : "info";
    const lvTxt = { bad: "мало", warn: "маловато", good: "в норме", info: "много" }[lv];
    const stageTot = deep + rem + core + awake;
    const seg = (v, cls) => (stageTot > 0 && v > 0 ? `<i class="${cls}" style="width:${(v / stageTot) * 100}%"></i>` : "");
    const lg = (name, v, cls) => (v > 0 ? `<div class="sl-lg"><i class="${cls}"></i><span>${name}</span><b>${fmtDur(v)}</b><small>${tot > 0 && name !== "Бодрствование" ? `${Math.round((v / tot) * 100)}%` : ""}</small></div>` : "");
    const tips = [];
    if (tot < 6) tips.push(["bad", `Сна меньше 6 часов. Ориентир для взрослых ${SLEEP_MIN}–${SLEEP_MAX} часов: постарайтесь лечь раньше.`]);
    else if (tot < SLEEP_MIN) tips.push(["warn", `До ${SLEEP_MIN} часов не хватило ${fmtDur(SLEEP_MIN - tot)}.`]);
    if (deep > 0 && deep / tot < 0.1) tips.push(["warn", `Глубокого сна мало: ${Math.round((deep / tot) * 100)}% (обычно 13–23%). Ему мешают кофеин, алкоголь и жара в комнате.`]);
    if (rem > 0 && rem / tot < 0.15) tips.push(["warn", `Фазы REM мало: ${Math.round((rem / tot) * 100)}% (обычно 20–25%).`]);
    if (inBed > 0 && tot / inBed < 0.85) tips.push(["warn", `В кровати вы провели ${fmtDur(inBed)}, спали ${fmtDur(tot)}: эффективность сна ${Math.round((tot / inBed) * 100)}% (хорошо от 85%).`]);
    const yd = addDays(day, -1);
    const lateCaf = fluidItems(yd).some((i) => itemCaf(i) > 0 && new Date(i.ts).getHours() >= 16);
    const lateAlc = fluidItems(yd).some((i) => /пиво|вино|водк|виски|коньяк|ром\b|джин|шампан|коктейл|алког/i.test(String(i.name || "")) && new Date(i.ts).getHours() >= 18);
    if (lateCaf) tips.push(["info", "Накануне вы пили кофеин после 16:00: он мог сократить глубокий сон."]);
    if (lateAlc) tips.push(["info", "Накануне вечером был алкоголь: он делает сон поверхностным."]);
    if (!tips.length) tips.push(["good", "Ночь выглядит хорошо: длительность в норме, замечаний нет."]);
    pSleep = `
    <section class="card">
      <div class="card-top"><h2 class="h2">Сон</h2><span class="pill ${lv === "good" ? "" : lv === "bad" ? "over" : lv === "warn" ? "warn" : ""}">${lvTxt}</span></div>
      <div class="big-line">${fmtDur(tot)}<small>за ночь</small></div>
      <div class="track sl-track ${lv}"><i style="width:${Math.min(100, (tot / 8) * 100)}%"></i></div>
      <p class="foot-note" style="margin:10px 0 12px">Ориентир ${SLEEP_MIN}–${SLEEP_MAX} часов.${sl.sleepStart && sl.sleepEnd ? ` Уснули в ${esc(sl.sleepStart)}, проснулись в ${esc(sl.sleepEnd)}.` : ""}</p>
      ${stageTot > 0 ? `<div class="sl-stages">${seg(deep, "deep")}${seg(rem, "rem")}${seg(core, "core")}${seg(awake, "awake")}</div>
      <div class="sl-legend">${lg("Глубокий", deep, "deep")}${lg("REM", rem, "rem")}${lg("Лёгкий", core, "core")}${lg("Бодрствование", awake, "awake")}</div>` : ""}
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat"><b>${inBed > 0 ? fmtDur(inBed) : "—"}</b><span>в кровати</span></div>
        <div class="stat"><b>${nights.length ? fmtDur(nAvg) : "—"}</b><span>в среднем за неделю${nights.length ? `<br>ночей с данными ${nights.length}` : ""}</span></div>
      </div>
    </section>
    <section class="card">
      <h2 class="h2">Что заметно</h2>
      <ul class="caf-msgs">${tips.map(([k, t]) => `<li class="${k === "bad" ? "over" : k === "good" ? "ok" : ""}">${esc(t)}</li>`).join("")}</ul>
    </section>
    ${barsCard("Сон за неделю", wk, (d) => Math.round(sleepHours(d) * 10) / 10, () => SLEEP_MIN, "ч", "sleep", false, (v) => fmt(v))}`;
  }
  const pDyn = `
    ${weightCard(day)}
    ${trainDynCardHtml(day)}
    ${barsCard("Калории за 7 дней", last7(day), (d) => sumEntries(entriesOn(d)).kcal, () => state.goal, "ккал", "", true)}
    ${barsCard("Сон за неделю", wk, (d) => Math.round(sleepHours(d) * 10) / 10, () => SLEEP_MIN, "ч", "sleep", false, (v) => fmt(v))}
    ${wkStepsDays.length ? barsCard("Шаги за неделю", wk, stepsOn, () => STEPS_GOAL, "шагов", "") : ""}`;
  return `
    ${pageHead("Здоровье", dayLabel(day), dayNavButtons(day))}
    ${plan ? "" : fillProfilePrompt}
    ${tabs}
    ${tab === "train" ? pTrain : tab === "sleep" ? pSleep : tab === "dyn" ? pDyn : pToday}`;
}

/* ----- Вес ----- */
const last7 = (day) => Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
const weightOn = (d) => { const w = state.weights.find((x) => x.date === d); return w ? Number(w.kg) : 0; };
const lastWeightUpTo = (d) => { let r = null; for (const w of state.weights) { if (w.date <= d) r = w; else break; } return r; };
function openWeight() {
  const day = state.date, cur = weightOn(day) || (lastWeightUpTo(day) ? Number(lastWeightUpTo(day).kg) : Number(state.profile.weightKg) || "");
  const ov = openSheet(`
    <div class="sheet-head"><h2>Вес</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <p class="foot-note" style="margin:-4px 2px 12px">Запись за ${esc(shortDate(day))}. Взвешивайтесь утром, в одно время: так динамика честнее.</p>
    <label class="field"><span>Вес, кг</span><input id="wt-kg" class="input big" inputmode="decimal" value="${cur ? String(cur).replace(".", ",") : ""}" autocomplete="off"></label>
    <div class="row">${weightOn(day) ? `<button type="button" class="btn danger" id="wt-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="wt-save">Сохранить</button></div>`);
  $("#wt-save", ov).addEventListener("click", () => {
    const kg = num($("#wt-kg", ov).value);
    if (!(kg >= 25 && kg <= 400)) return;
    setDoc(docRef("weights", day), { date: day, kg: Math.round(kg * 10) / 10, updatedAt: serverTimestamp() }).catch(writeFail);
    ov.close();
  });
  const del = $("#wt-del", ov);
  if (del) del.addEventListener("click", () => { deleteDoc(docRef("weights", day)).catch(writeFail); ov.close(); });
}

const WT_RANGES = [[30, "30 дн"], [90, "90 дн"], [0, "Всё"]];
// График веса за период: точки записей + среднее за 7 дней, изменение и скорость
function weightBlock(from, day, label) {
  const all = state.weights.filter((w) => w.date <= day);
  const pts = all.filter((w) => w.date >= from).map((w) => ({ d: w.date, v: Number(w.kg) }));
  const dayN = (d) => Math.round((parseD(d) - parseD(from)) / 86400000);
  const span = Math.max(1, dayN(day));
  pts.forEach((p) => {
    const win = all.filter((w) => w.date <= p.d && w.date > addDays(p.d, -7)).map((w) => Number(w.kg));
    p.avg = win.reduce((a, b) => a + b, 0) / win.length;
  });
  const lw = lastWeightUpTo(day);
  let svg = "", note = "Запишите вес на вкладке «Здоровье» → «Динамика», и здесь появится график.";
  if (pts.length) {
    const vs = pts.flatMap((p) => [p.v, p.avg]), lo = Math.min(...vs), hi = Math.max(...vs), pad = Math.max(0.3, (hi - lo) * 0.15);
    const mn = lo - pad, mx = hi + pad, L = 30, R = 292;
    const X = (d) => L + (dayN(d) / span) * (R - L), Y = (v) => 8 + (1 - (v - mn) / (mx - mn)) * 66;
    const line = pts.length > 1 ? `<polyline points="${pts.map((p) => `${X(p.d).toFixed(1)},${Y(p.avg).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    const dots = pts.map((p) => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${pts.length > 45 ? 1.8 : 3}" fill="var(--muted-2)" opacity=".75"/>`).join("");
    const lastp = pts[pts.length - 1];
    const end = pts.length === 1 ? `<circle cx="${X(lastp.d).toFixed(1)}" cy="${Y(lastp.v).toFixed(1)}" r="4.5" fill="var(--card)" stroke="var(--accent)" stroke-width="2.5"/>` : "";
    const ax = `<text x="0" y="${(Y(hi) + 3).toFixed(1)}" font-size="10" fill="var(--muted)">${fmt(Math.round(hi * 10) / 10)}</text><text x="0" y="${(Y(lo) + 3).toFixed(1)}" font-size="10" fill="var(--muted)">${fmt(Math.round(lo * 10) / 10)}</text>`;
    svg = `<svg class="wt-svg" viewBox="0 0 300 84" role="img" aria-label="График веса">${ax}${dots}${line}${end}</svg>
      <div class="wt-axis"><span>${esc(shortDate(from))}</span><span>${esc(shortDate(day))}</span></div>`;
    if (pts.length < 2) note = "Одна запись. Взвешивайтесь раз в 2–3 дня, и здесь появится динамика.";
    else {
      const delta = pts[pts.length - 1].avg - pts[0].avg;
      const days = Math.max(1, Math.round((parseD(pts[pts.length - 1].d) - parseD(pts[0].d)) / 86400000));
      const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
      note = `<b>${sign(delta)}${fmt(Math.abs(Math.round(delta * 10) / 10))} кг</b> ${label}` + (days >= 7 ? `, около ${sign(delta)}${fmt(Math.abs(Math.round((delta / days) * 70) / 10))} кг в неделю.` : "." + " Для скорости нужно хотя бы 7 дней между записями.");
      note += ` <span class="wt-legend"><i class="d"></i>записи <i class="l"></i>среднее за 7 дней</span>`;
    }
  }
  return { svg, note, last: lw, count: pts.length };
}

function weightCard(day) {
  const range = state.wtRange == null ? 30 : state.wtRange;
  const all = state.weights.filter((w) => w.date <= day);
  const from = range ? addDays(day, -(range - 1)) : (all.length ? all[0].date : day);
  const b = weightBlock(from, day, range ? `за ${range} дн.` : "за всё время");
  const segs = `<div class="seg full wt-seg">${WT_RANGES.map(([v, t]) => `<button type="button" data-act="wtRange" data-v="${v}" class="${range === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Вес</h2><span class="pill">${b.last ? `${fmt(b.last.kg)} кг` : "нет записей"}</span></div>
    ${segs}
    ${b.svg}
    <p class="chart-note" style="margin:8px 0 12px">${b.note}</p>
    <button type="button" class="btn ghost full" data-act="addWeight">+ Записать вес</button>
  </section>`;
}

function chartLabels(days) {
  const step = days.length <= 7 ? 1 : Math.ceil(days.length / 7);
  return days.map((d, i) => {
    const dt = parseD(d);
    const t = days.length <= 7 ? WD_SHORT[dt.getDay()] : (i % step === 0 ? `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, "0")}` : "");
    return `<span>${t}</span>`;
  }).join("");
}

function barsCard(title, days, valFn, goalFn, unit, cls, overLimit, fv) {
  const F = fv || fmtInt;
  const vals = days.map(valFn);
  const goal = goalFn ? Math.max(...days.map((d) => goalFn(d))) : 0;
  const max = Math.max(goal * 1.15, ...vals, 1);
  const bars = vals.map((v, i) => {
    const over = overLimit && goalFn && v > goalFn(days[i]);
    return `<div class="col"><div class="b ${v > 0 ? (over ? "over" : cls) : "zero"}" style="height:${v > 0 ? Math.max(2, (v / max) * 100) : 2}%"></div></div>`;
  }).join("");
  const withData = vals.filter((v) => v > 0);
  const avg = withData.length ? withData.reduce((a, b) => a + b, 0) / withData.length : 0;
  return `<section class="card"><h2 class="h2">${title}</h2>
    <div class="chart">${bars}${goal > 0 ? `<div class="goal" style="bottom:${(goal / max) * 100}%"></div>` : ""}</div>
    <div class="chart-labels">${chartLabels(days)}</div>
    <p class="chart-note">${withData.length ? `В среднем за день с записями: <b>${F(avg)} ${unit}</b>.` : "Пока нет данных."}${goal > 0 ? ` Пунктир: норма (${F(goal)} ${unit}).` : ""}${overLimit ? " Красным отмечены дни выше нормы." : ""}</p></section>`;
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
      <div class="stat"><b>${fmtInt(plan.kcal)}</b><span>ккал в день (цель дневника)</span></div>
      <div class="stat"><b>${fmtInt(plan.water)} мл</b><span>базовая норма воды<br>плюс 8 мл за минуту нагрузки</span></div>
      <div class="stat"><b>${plan.protein} г</b><span>белки в день</span></div>
      <div class="stat"><b>${plan.fat} г</b><span>жиры в день</span></div>
      <div class="stat"><b>${plan.carbs} г</b><span>углеводы в день</span></div>
      <div class="stat"><b>${fmt(plan.bmi)}</b><span>индекс массы тела: ${plan.bmiLabel}</span></div>
    </div>
    <p class="foot-note" style="margin:12px 0 0">Основной обмен: ${fmtInt(plan.bmr)} ккал, расход с учётом образа жизни: ${fmtInt(plan.tdee)} ккал. ${esc(plan.weekly.text)} Это примерно ${fmtInt(plan.weekly.kcal)} ккал в неделю.</p>
    ${plan.calcKcal && Math.abs(plan.calcKcal - plan.kcal) >= 30 ? `<div class="warn">Расчёт по вашему профилю даёт ${fmtInt(plan.calcKcal)} ккал, а цель в дневнике ${fmtInt(plan.kcal)} ккал. <button type="button" class="btn ghost sm" style="margin-top:8px" data-act="applyPlanGoal">Использовать расчёт</button></div>` : ""}
    ${warns}
    <p class="foot-note" style="margin:12px 0 0">Индекс массы тела не учитывает мышечную массу. Все значения ориентировочные, для здоровых взрослых, и не заменяют рекомендацию врача. При беременности, диабете и других заболеваниях согласуйте питание и нагрузку с врачом.</p>
  </section>`;
}

function previewPlanHtml(plan) {
  return `<div class="pv-kcal">${fmtInt(plan.kcal)}<small>ккал в день</small></div>
    <div class="pv-macros"><div><b>${plan.protein}</b>белки, г</div><div><b>${plan.fat}</b>жиры, г</div><div><b>${plan.carbs}</b>углеводы, г</div></div>
    <p class="foot-note" style="margin:10px 0 0">Базовая норма воды: <b>${fmtInt(plan.water)} мл</b> в день. Нагрузка: <b>${plan.weekly.minutes} мин</b> в неделю.</p>
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

// Вода всегда пишется отдельной записью с временем (история выпитого), а не прибавляется к сумме дня.
// Уменьшение («−250») тоже запись, но не больше, чем воды записано за день.
const isWaterDrink = (x) => x.drinkId === "water";
const plainWaterOn = (d) => waterOn(d) + (byDateIndex("drinks").get(d) || EMPTY).filter(isWaterDrink).reduce((sum, x) => sum + (Number(x.ml) || 0), 0);
function openRemoveSheet() {
  const day = state.date;
  const recs = (byDateIndex("drinks").get(day) || EMPTY).filter((x) => Number(x.ml) > 0)
    .sort((a, b) => String(timeOf(a.createdAt)).localeCompare(String(timeOf(b.createdAt))));
  const legacy = Math.round(waterOn(day));
  if (!recs.length && legacy <= 0) { toast("За этот день нет записей жидкости"); return; }
  const ov = openSheet(`
    <div class="sheet-head"><h2>Убрать жидкость</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <label class="field"><span>Сколько убрать, мл</span><input id="rm-ml" class="input big" inputmode="numeric" value="250" autocomplete="off"></label>
    <p class="foot-note" style="margin:0 2px 8px">Выберите запись, из которой убрать:</p>
    <div class="plist">${recs.slice().reverse().map((x) => `<div class="drow"><button type="button" class="d-main" data-rid="${x.id}"><span class="p-name">${esc(x.name)}</span><span class="p-sub">${timeOf(x.createdAt)} · ${fmt(x.ml)} мл</span></button></div>`).join("")}
    ${legacy > 0 ? `<div class="drow"><button type="button" class="d-main" data-rid="__legacy"><span class="p-name">Вода</span><span class="p-sub">записано суммой за день · ${fmt(legacy)} мл</span></button></div>` : ""}</div>`);
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rid]");
    if (!b) return;
    const want = Math.round(num($("#rm-ml", ov).value));
    if (!(want > 0)) { toast("Введите объём"); return; }
    if (b.dataset.rid === "__legacy") {
      setDoc(doc(db, "users", state.user.uid, "water", day), { date: day, ml: Math.max(0, legacy - want) }, { merge: true }).catch(writeFail);
    } else {
      const x = recs.find((r) => r.id === b.dataset.rid);
      if (!x) return;
      const left = Math.round(Number(x.ml) - want);
      if (left > 0) updateDoc(docRef("drinks", x.id), { ml: left }).catch(writeFail);
      else deleteDoc(docRef("drinks", x.id)).catch(writeFail);
    }
    ov.close();
  });
}

function changeWater(n) {
  const day = state.date;
  let ml = Math.round(Number(n));
  if (!ml) return;
  if (ml < 0) {
    ml = -Math.min(-ml, Math.max(0, Math.round(plainWaterOn(day))));
    if (!ml) return;
  }
  addDoc(colRef("drinks"), { drinkId: "water", name: "Вода", ml, pct: 100, caf100: 0, alc: "", date: day, createdAt: serverTimestamp() }).catch(writeFail);
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

/* ================= Быстрые действия: ссылки для «Команд» iPhone ================= */
const QUICK = [
  { t: "Выпить 250 мл воды", q: "add=water&ml=250" },
  { t: "Выпить 500 мл воды", q: "add=water&ml=500" },
  { t: "Добавить еду (приём пищи по времени суток)", q: "open=food" },
  { t: "Сканировать штрих-код", q: "open=scan" },
  { t: "Добавить напиток", q: "open=drink" },
  { t: "Добавить нагрузку", q: "open=activity" },
  { t: "Открыть «Здоровье»", q: "tab=health" },
];
const TAB_IDS = ["diary", "products", "health", "reports", "me"];
const baseUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");
const mealByTime = () => { const h = new Date().getHours(); return h >= 5 && h < 11 ? "breakfast" : h >= 11 && h < 16 ? "lunch" : h >= 16 && h < 21 ? "dinner" : "snack"; };

// Читаем параметры из адреса один раз и сразу убираем их, чтобы обновление страницы не повторило действие
function readLinkFromUrl() {
  const p = new URLSearchParams(location.search);
  const link = {};
  ["add", "open", "meal", "tab", "ml"].forEach((k) => { if (p.get(k)) link[k] = p.get(k); });
  if (!Object.keys(link).length) return;
  try { sessionStorage.setItem("pendingLink", JSON.stringify(link)); } catch { /* ignore */ }
  history.replaceState(null, "", location.pathname + location.hash);
}

function runPendingLink() {
  let link = null;
  try { link = JSON.parse(sessionStorage.getItem("pendingLink") || "null"); sessionStorage.removeItem("pendingLink"); } catch { /* ignore */ }
  if (!link) return;
  state.obShown = true; // с быстрыми действиями окно знакомства не показываем
  state.date = todayStr();
  const meal = MEALS.some((m) => m.id === link.meal) ? link.meal : mealByTime();
  if (TAB_IDS.includes(link.tab)) { state.tab = link.tab; render(); }
  if (link.add === "water") {
    const ml = Math.round(Number(link.ml) || 250);
    if (ml > 0 && ml <= 3000) changeWater(ml);
    state.tab = "health"; render();
  }
  if (link.open === "food") openAddFood(meal);
  if (link.open === "scan") { openAddFood(meal); setTimeout(() => { const b = document.querySelector("#af-scan"); if (b) b.click(); }, 200); }
  if (link.open === "activity") { state.tab = "health"; render(); openActivitySheet(null); }
  if (link.open === "water") { state.tab = "health"; render(); openWaterSheet(); }
  if (link.open === "drink") { state.tab = "health"; render(); openDrinkSheet(); }
}

function quickCardHtml() {
  return `<section class="card">
    <h2 class="h2">Быстрые действия для iPhone</h2>
    <p class="foot-note" style="margin:0 0 6px">Скопируйте нужную ссылку и сделайте из неё команду: она станет виджетом или иконкой на экране «Домой» и добавит воду или откроет нужное окно в одно касание.</p>
    <div class="quick-list">${QUICK.map((x) => `<div class="quick-row"><span>${esc(x.t)}</span><button type="button" class="btn ghost sm" data-act="copyLink" data-q="${esc(x.q)}">Копировать</button></div>`).join("")}</div>
    <ol class="steps">
      <li>Откройте приложение «Команды», нажмите «+» и добавьте действие «Открыть URL».</li>
      <li>Вставьте скопированную ссылку и назовите команду, например «Вода 250».</li>
      <li>Чтобы сделать виджет: на экране «Домой» нажмите и удерживайте пустое место, «+», выберите «Команды» и вашу команду. Отдельная иконка: в команде нажмите «i», затем «На экран «Домой»».</li>
      <li>Команда откроет сайт в Safari. Один раз войдите там через Google, дальше всё добавляется сразу.</li>
    </ol>
  </section>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* запасной способ ниже */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ================= Напитки: окно выбора ================= */
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>';
const SWEET_CATS = ["sugar", "fruit", "active"];

function toggleFav(id) {
  const next = state.fav.includes(id) ? state.fav.filter((x) => x !== id) : [...state.fav, id];
  state.fav = next;
  setDoc(doc(db, "users", state.user.uid, "settings", "drinks"), { fav: next }, { merge: true }).catch(writeFail);
}

// entry: запись, которую правим; presetId: сразу открыть напиток (из избранного)
function openDrinkSheet(entry, presetId, presetMl, prefill) {
  const ov = openSheet(`
    <div class="sheet-head"><h2>Напиток</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div id="dk-body"></div>`);
  const body = $("#dk-body", ov);
  const st = { q: "", cat: "all" };

  const rowHtml = (d) => {
    const sub = [d.k > 0 ? `${d.k} ккал/100 мл` : "", d.c > 0 ? `${d.c} мг кофеина` : "", d.a].filter(Boolean).join(", ");
    return `<div class="drow">
      <button type="button" class="d-main" data-did="${d.id}"><span class="p-name">${esc(d.n)}</span>${sub ? `<span class="p-sub">${esc(sub)}</span>` : ""}</button>
      <span class="d-pct ${d.h < 0 ? "neg" : ""}">${d.h}%</span>
      <button type="button" class="star ${state.fav.includes(d.id) ? "on" : ""}" data-star="${d.id}" aria-label="В избранное">${STAR_SVG}</button>
    </div>`;
  };

  function showList() {
    const favs = favDrinks();
    body.innerHTML = `
      ${presetMl > 0 ? `<p class="foot-note" style="margin:0 2px 8px">Выберите напиток для ${fmt(presetMl)} мл</p>` : ""}
      <input id="dk-q" class="input search" type="search" placeholder="Найти напиток" value="${esc(st.q)}" autocomplete="off">
      ${favs.length ? `<p class="foot-note" style="margin:0 2px 8px">Избранное и частые</p><div class="chips">${favs.map((d) => `<button type="button" class="chip" data-did="${d.id}">${esc(d.n)}</button>`).join("")}</div>` : ""}
      <div class="chips cats" id="dk-cats">${DRINK_CATS.map((c) => `<button type="button" class="chip ${st.cat === c.id ? "sel" : ""}" data-cat="${c.id}">${c.t}</button>`).join("")}</div>
      <div id="dk-list" class="plist"></div>
      <p class="foot-note" style="margin:10px 2px 12px">Кофеин указан на 240 мл (стакан) и пересчитывается на ваш объём. Гидратация показывает, сколько мл жидкости засчитывается на каждые 100 мл напитка. У алкоголя значение отрицательное: он уменьшает баланс жидкости.</p>
      <div class="note">Напитки с калориями (капучино, сок, газировка, алкоголь) добавляются и в жидкость, и в калории дневника одной записью. Напиток из магазина можно добавить по штрих-коду.</div>
      <div class="row"><button type="button" class="btn ghost grow" id="dk-scan">Сканировать код</button></div>`;
    draw();
    $("#dk-q", ov).addEventListener("input", (e) => { st.q = e.target.value; draw(); });
    $("#dk-scan", ov).addEventListener("click", () => {
      ov.close();
      openAddFood(mealByTime());
      setTimeout(() => { const b = document.querySelector("#af-scan"); if (b) b.click(); }, 250);
    });
  }

  function draw() {
    const words = fold(st.q).split(/\s+/).filter(Boolean);
    const list = allDrinks().filter((d) => (st.cat === "all" || d.cat === st.cat) && words.every((w) => fold(d.n).includes(w)))
      .sort((a, b) => (a.id === "water" ? -1 : b.id === "water" ? 1 : a.n.localeCompare(b.n, "ru")));
    $("#dk-list", ov).innerHTML = list.length ? list.map(rowHtml).join("") : `<div class="empty"><b>Ничего не найдено</b>Создать карточку можно во вкладке «Продукты» кнопкой «+».</div>`;
  }

  body.addEventListener("click", (e) => {
    const cat = e.target.closest("[data-cat]");
    if (cat) {
      st.cat = cat.dataset.cat;
      body.querySelectorAll("#dk-cats .chip").forEach((c) => c.classList.toggle("sel", c.dataset.cat === st.cat));
      draw();
      return;
    }
    const star = e.target.closest("[data-star]");
    if (star) { toggleFav(star.dataset.star); star.classList.toggle("on", state.fav.includes(star.dataset.star)); return; }
    const pick = e.target.closest("[data-did]");
    if (pick && drinkById(pick.dataset.did)) showDetail(drinkById(pick.dataset.did));
  });

  // Карточка своего напитка: категория, гидратация, кофеин, БЖУ на 100 мл и штрих-коды (несколько упаковок/партий)
  function showCard(d, isNew, from) {
    const bcs = [...(d.bc || [])];
    const v = (x) => (x === "" || x == null ? "" : String(x).replace(".", ","));
    const cafInit = d.c > 0 ? r1((d.c / 240) * 100) : 0;
    const alcOpts = [["Слабый алкоголь", "Слабый (пиво, сидр)"], ["Легкий алкоголь", "Лёгкий"], ["Умеренный алкоголь", "Умеренный"], ["Средний алкоголь", "Средний (вино, вермут)"], ["Крепкий алкоголь", "Крепкий (водка, виски, коньяк)"]];
    const alcSel0 = alcOpts.some((o) => o[0] === d.a) ? d.a : "Средний алкоголь";
    body.innerHTML = `
      <div class="picked"><div class="p-name">${isNew ? "Новый напиток" : "Карточка напитка"}</div></div>
      ${from ? `<div class="note">Продукт «${esc(from.name)}» переносится в напитки. Проверьте категорию и гидратацию и сохраните: из продуктов он исчезнет.</div>` : ""}
      <label class="field"><span>Категория</span><select id="dc-cat" class="input">${DRINK_CATS.filter((c) => c.id !== "all").map((c) => `<option value="${c.id}" ${c.id === d.cat ? "selected" : ""}>${c.t}</option>`).join("")}</select></label>
      <label class="field ${d.cat === "alc" ? "" : "hidden"}" id="dc-alc-box"><span>Крепость</span><select id="dc-alc" class="input">${alcOpts.map((o) => `<option value="${o[0]}" ${o[0] === alcSel0 ? "selected" : ""}>${o[1]}</option>`).join("")}</select></label>
      <p class="foot-note" id="dc-hint" style="margin:-4px 2px 10px"></p>
      <label class="field"><span>Название</span><input id="dc-name" class="input" maxlength="60" value="${esc(d.n)}" autocomplete="off" placeholder="Например, Матэ"></label>
      <div class="field-grid">
        <label class="field"><span>Гидратация, %</span><input id="dc-pct" class="input" inputmode="decimal" value="${v(d.h)}" autocomplete="off"></label>
        <label class="field"><span>Кофеин, мг на 100 мл</span><input id="dc-caf" class="input" inputmode="decimal" value="${v(cafInit)}" autocomplete="off"></label>
      </div>
      <div class="chips" style="margin:-4px 0 10px"><button type="button" class="chip muted" id="dc-sign">± Сменить знак гидратации (минус для алкоголя)</button></div>
      <div class="field"><span>Значения на 100 мл</span></div>
      <div class="field-grid">
        <label class="field"><span>Калории, ккал</span><input id="dc-k" class="input" inputmode="decimal" value="${v(d.k)}" autocomplete="off"></label>
        <label class="field"><span>Белки, г</span><input id="dc-p" class="input" inputmode="decimal" value="${v(d.p)}" autocomplete="off"></label>
        <label class="field"><span>Жиры, г</span><input id="dc-f" class="input" inputmode="decimal" value="${v(d.f)}" autocomplete="off"></label>
        <label class="field"><span>Углеводы, г</span><input id="dc-cb" class="input" inputmode="decimal" value="${v(d.cb)}" autocomplete="off"></label>
      </div>
      <div class="field"><span>Штрих-коды (можно несколько: другие упаковки и партии)</span>
        <div id="dc-bc-list" class="chips"></div>
        <div class="inline"><input id="dc-bc-in" class="input" inputmode="numeric" maxlength="20" placeholder="Штрих-код" autocomplete="off"><button type="button" class="icon-btn" id="dc-bc-scan" aria-label="Сканировать штрих-код">${SCAN_SVG}</button><button type="button" class="btn ghost sm" id="dc-bc-add">Добавить</button></div>
      </div>
      ${isNew ? "" : `<button type="button" class="btn soft full" id="dc-toprod" style="margin:4px 0 12px">Это продукт: перенести в продукты</button>`}
      <div class="row">${isNew ? `<button type="button" class="btn ghost" id="dc-back">Назад</button>` : `<button type="button" class="btn danger" id="dc-del">Удалить</button>`}<button type="button" class="btn primary grow" id="dc-save">Сохранить</button></div>`;
    const list = $("#dc-bc-list", ov), inp = $("#dc-bc-in", ov);
    const drawBc = () => { list.innerHTML = bcs.map((c) => `<span class="chip alias">${esc(c)}<button type="button" class="alias-x" data-bcdel="${esc(c)}" aria-label="Убрать код">×</button></span>`).join(""); };
    drawBc();
    const addBc = (raw) => {
      const code = String(raw || "").replace(/\D/g, "");
      if (code.length < 6) { toast("Введите штрих-код полностью (цифры)"); return; }
      if (bcs.some((c) => normBC(c) === normBC(code))) { toast("Этот код уже добавлен"); return; }
      const msg = bcConflict(code, { drinkId: d.id, productId: from && from.id });
      if (msg) { toast(msg); return; }
      bcs.push(code); inp.value = ""; drawBc();
    };
    $("#dc-bc-add", ov).addEventListener("click", () => addBc(inp.value));
    $("#dc-bc-scan", ov).addEventListener("click", () => openScanner((code) => addBc(code)));
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-bcdel]");
      if (!b) return;
      const i = bcs.findIndex((c) => c === b.dataset.bcdel);
      if (i >= 0) bcs.splice(i, 1);
      drawBc();
    });
    const catSel = $("#dc-cat", ov), alcSel = $("#dc-alc", ov), alcBox = $("#dc-alc-box", ov), pct = $("#dc-pct", ov);
    const medianPct = (a) => { const x = DRINKS.filter((y) => y.cat === "alc" && y.a === a).map((y) => y.h).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : -95; };
    // Подсказка: ориентировочная гидратация типичных напитков выбранной категории
    const HINT_NAMES = {
      tea: ["Черный Чай", "Зеленый Чай", "Матча", "Чай Латте", "Бабл Ти"], coffee: ["Эспрессо", "Американо", "Капучино", "Латте", "Флэт Уайт"],
      milk: ["Молоко", "Молочный Коктейль", "Какао", "Йогурт", "Айран"], sugar: ["Лимонад", "Газировка", "Диетическая Газировка", "Амадзакэ"],
      fruit: ["Сок", "Смузи", "Суаньмэйтан"], active: ["Спорт. Напиток", "Протеин", "Энергетик"], mock: ["Безалкогольный Мохито", "Ширли Темпл", "Пиво Б/А", "Вино Б/А"],
      alc: ["Пиво", "Сидр", "Красное Вино", "Мохито", "Виски", "Водка"], other: ["Вода", "Суп", "Костный Бульон", "Борщ"],
    };
    const hintEl = $("#dc-hint", ov);
    const drawHint = () => {
      const items = (HINT_NAMES[catSel.value] || []).map((n) => DRINKS.find((x) => x.n === n)).filter(Boolean);
      hintEl.textContent = `Гидратация: сколько мл из каждых 100 мл засчитывается в норму жидкости.${items.length ? " Ориентиры: " + items.map((x) => `${x.n.toLowerCase()} ${x.h < 0 ? "−" + Math.abs(x.h) : x.h}%`).join(", ") + "." : ""}`;
    };
    drawHint();
    const sync = () => {
      const isAlc = catSel.value === "alc";
      alcBox.classList.toggle("hidden", !isAlc);
      drawHint();
      if (isAlc) pct.value = String(medianPct(alcSel.value)).replace(".", ",");
      else if (numS(pct.value) < 0) pct.value = "90";
    };
    catSel.addEventListener("change", sync);
    alcSel.addEventListener("change", () => { pct.value = String(medianPct(alcSel.value)).replace(".", ","); });
    $("#dc-sign", ov).addEventListener("click", () => {
      const t = String(pct.value).trim(), w = t.replace(/^[−–-]\s*/, "");
      pct.value = /^[−–-]/.test(t) ? w : (w ? "-" + w : "-");
    });
    const back = $("#dc-back", ov);
    if (back) back.addEventListener("click", showList);
    const removeFromList = () => {
      state.customDrinks = state.customDrinks.filter((x) => x.id !== d.id);
      state.fav = state.fav.filter((x) => x !== d.id);
      if ((state.sharedDrinks || []).some((x) => x.id === d.id)) deleteSharedDrink(d.id);
      saveCustomDrinks({ fav: state.fav });
    };
    const del = $("#dc-del", ov);
    if (del) del.addEventListener("click", () => {
      if (!confirm(`Удалить «${d.n}» из списка напитков? Прошлые записи останутся.`)) return;
      removeFromList();
      showList();
    });
    const toProd = $("#dc-toprod", ov);
    if (toProd) toProd.addEventListener("click", () => {
      if (!confirm(`Перенести «${d.n}» в продукты? Гидратация и кофеин учитываться перестанут, напиток пропадёт из списка напитков. Прошлые записи останутся.`)) return;
      const codes = (d.bc || []).filter(Boolean);
      for (const c of codes) { const p = findByBarcode(c); if (p) { toast(`Код ${c} уже есть среди продуктов: ${p.name}`); return; } }
      const barcode = codes[0] || "";
      const id = productIdFor({ barcode, source: "user", name: d.n });
      const ref = id ? prodDoc(id) : doc(prodCol());
      setDoc(ref, { name: d.n, brand: "", barcode, kcal: d.k || 0, protein: d.p || 0, fat: d.f || 0, carbs: d.cb || 0, drink: false, hydrationPct: 0, caffeineMg100: 0, source: "user", ...authorFields(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(writeFail);
      codes.slice(1).forEach((c) => linkBarcode(c, ref.id));
      removeFromList();
      toast("Перенесено в продукты");
      showList();
    });
    $("#dc-save", ov).addEventListener("click", () => {
      const name = $("#dc-name", ov).value.trim();
      const opt = (sel) => { const t = $(sel, ov).value.trim(); return t === "" ? 0 : num(t); };
      const h = numS(pct.value), caf = opt("#dc-caf"), k = opt("#dc-k"), p = opt("#dc-p"), f = opt("#dc-f"), cb = opt("#dc-cb");
      if (!name) { toast("Введите название напитка"); return; }
      if (!Number.isFinite(h) || h < -400 || h > 200) { toast("Гидратация: от −400 до 200 процентов"); return; }
      if (!Number.isFinite(caf) || caf < 0 || caf > 1000) { toast("Кофеин: от 0 до 1000 мг на 100 мл"); return; }
      if (![k, p, f, cb].every(Number.isFinite) || k < 0 || p < 0 || f < 0 || cb < 0) { toast("Калории и БЖУ: введите числа"); return; }
      if (k > 1000) { toast("Калории на 100 мл: не больше 1000"); return; }
      if ([p, f, cb].some((x) => x > 100)) { toast("Белки, жиры и углеводы на 100 мл: не больше 100"); return; }
      for (const c of bcs) { const m = bcConflict(c, { drinkId: d.id, productId: from && from.id }); if (m) { toast(m); return; } }
      const cat = catSel.value;
      const item = { id: isNew ? newDrinkId() : d.id, n: name, h, c: Math.round(((caf * 240) / 100) * 10) / 10, cat, a: cat === "alc" ? alcSel.value : "", k, p, f, cb, bc: [...bcs] };
      state.customDrinks = state.customDrinks.filter((x) => x.id !== item.id);
      saveSharedDrink(item);
      if (from) {
        aliasCodes(from.id).forEach((c) => { if (state.bcOwner[c] === state.user.uid) unlinkBarcode(c); });
        deleteDoc(prodDoc(from.id)).catch(writeFail);
      }
      toast(from ? "Перенесено в напитки" : "Напиток сохранён");
      showDetail(drinkById(item.id) || item);
    });
  }

  function showDetail(d, existing) {
    const isCustom = d.id === "custom";
    const isWater = d.id === "water" && !existing;
    const oldCaf = existing ? (Number(existing.ml) * Number(existing.caf100)) / 100 : 0;
    const lastMl = existing ? existing.ml : (presetMl > 0 ? presetMl : (Number(lsGet(`dml:${d.id}`)) || 250));
    body.innerHTML = `
      <div class="picked"><div class="p-name">${isCustom ? (existing ? "Свой напиток" : "Новый напиток") : esc(d.n)}</div>${isCustom ? "" : `<div class="p-sub">${d.a ? `${esc(d.a)}. ` : ""}Гидратация ${d.h}%${d.c > 0 ? `, кофеин ${fmt(d.c)} мг на 240 мл` : ""}</div>`}</div>
      ${isCustom ? `${existing ? "" : `<label class="field"><span>Категория</span><select id="dk-cat" class="input">${DRINK_CATS.filter((c) => c.id !== "all").map((c) => `<option value="${c.id}" ${c.id === d.cat ? "selected" : ""}>${c.t}</option>`).join("")}</select></label>
        <label class="field hidden" id="dk-alc-box"><span>Крепость</span><select id="dk-alc" class="input"><option value="Слабый алкоголь">Слабый (пиво, сидр)</option><option value="Легкий алкоголь">Лёгкий</option><option value="Умеренный алкоголь">Умеренный</option><option value="Средний алкоголь" selected>Средний (вино, вермут)</option><option value="Крепкий алкоголь">Крепкий (водка, виски, коньяк)</option></select></label>`}
        <label class="field"><span>Название</span><input id="dk-name" class="input" maxlength="60" value="${existing ? esc(existing.name) : ""}" autocomplete="off" placeholder="Например, Матэ"></label>
        <div class="field-grid">
          <label class="field"><span>Гидратация, %</span><input id="dk-pct" class="input" inputmode="decimal" value="${String(d.h).replace(".", ",")}" autocomplete="off"></label>
          <label class="field"><span>Кофеин, мг на 100 мл</span><input id="dk-caf" class="input" inputmode="decimal" value="${existing ? String(existing.caf100).replace(".", ",") : "0"}" autocomplete="off"></label>
        </div>
        <div class="chips" style="margin:-4px 0 10px"><button type="button" class="chip muted" id="dk-sign">± Сменить знак гидратации (минус для алкоголя)</button></div>
        <label class="field"><span>Калории, ккал на 100 мл (если есть)</span><input id="dk-kcal" class="input" inputmode="decimal" value="0" autocomplete="off"></label>
        ${existing ? "" : `<label class="check"><input type="checkbox" id="dk-keep" checked> <span>Сохранить в список напитков</span></label>`}` : ""}
      <label class="field"><span>Объём, мл</span><input id="dk-ml" class="input big" inputmode="decimal" value="${String(lastMl).replace(".", ",")}" autocomplete="off"></label>
      <div class="chips">${[100, 150, 200, 250, 330, 500].map((n) => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join("")}</div>
      <div class="preview" id="dk-prev"></div>
      <div id="dk-kbox" class="hidden">
        <div class="note" id="dk-knote">Попадёт и в жидкость, и в калории дневника одной записью. Повторно вносить как еду не нужно.</div>
        <label class="field"><span>Приём пищи</span><select id="dk-meal" class="input">${MEALS.map((m) => `<option value="${m.id}" ${m.id === mealByTime() ? "selected" : ""}>${m.name}</option>`).join("")}</select></label>
      </div>
      <div class="row">${existing ? `<button type="button" class="btn danger" id="dk-del">Удалить</button>` : `<button type="button" class="btn ghost" id="dk-back">Назад</button>`}${d.mine && !existing ? `<button type="button" class="btn ghost" id="dk-card">Карточка</button>` : ""}<button type="button" class="btn primary grow" id="dk-save">${existing ? "Сохранить" : "Добавить"}</button></div>`;

    const read = () => {
      const ml = num($("#dk-ml", ov).value);
      if (isCustom) {
        const k = num($("#dk-kcal", ov).value);
        return { ml, pct: numS($("#dk-pct", ov).value), caf100: num($("#dk-caf", ov).value), name: $("#dk-name", ov).value.trim() || "Свой напиток", nutr: { kcal: k, protein: 0, fat: 0, carbs: 0 } };
      }
      return { ml, pct: d.h, caf100: r1((d.c / 240) * 100), name: d.n, nutr: { kcal: d.k || 0, protein: d.p || 0, fat: d.f || 0, carbs: d.cb || 0 } };
    };
    const upd = () => {
      if (!$("#dk-prev", ov)) return;
      const r = read();
      const eff = r.ml > 0 && Number.isFinite(r.pct) ? (r.ml * r.pct) / 100 : 0;
      const caf = r.ml > 0 && Number.isFinite(r.caf100) ? (r.ml * r.caf100) / 100 : 0;
      const kc = (!existing && r.ml > 0 && !isWater) ? calc(r.nutr, r.ml) : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      const kb = $("#dk-kbox", ov);
      if (kb) kb.classList.toggle("hidden", !(kc.kcal > 0));
      $("#dk-prev", ov).innerHTML = `
        <div class="pv-kcal ${eff < 0 ? "neg" : ""}">${signed(Math.round(eff))}<small>мл жидкости засчитано</small></div>
        <div class="pv-macros"><div><b>${fmt(r.ml > 0 ? r.ml : 0)}</b>выпито, мл</div><div><b>${Number.isFinite(r.pct) ? fmt(r.pct) : 0}%</b>гидратация</div><div><b>${fmtInt(caf)}</b>кофеин, мг</div></div>
        ${kc.kcal > 0 ? `<div class="pv-macros" style="margin-top:8px"><div><b>${fmtInt(kc.kcal)}</b>ккал</div><div><b>${fmt(kc.protein)}</b>белки, г</div><div><b>${fmt(kc.fat)}</b>жиры, г</div><div><b>${fmt(kc.carbs)}</b>углеводы, г</div></div>` : ""}
        ${isWater ? "" : cafWarnHtml(caf, oldCaf)}`;
    };
    upd();
    body.addEventListener("input", upd);
    body.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { $("#dk-ml", ov).value = c.dataset.n; upd(); }));
    const signBtn = $("#dk-sign", ov);
    if (signBtn) signBtn.addEventListener("click", () => {
      const inp = $("#dk-pct", ov), v = String(inp.value).trim().replace(/^[−–-]\s*/, "");
      inp.value = /^[−–-]/.test(String(inp.value).trim()) ? v : (v ? "-" + v : "-");
      upd();
    });
    const catSel = $("#dk-cat", ov), alcSel = $("#dk-alc", ov), alcBox = $("#dk-alc-box", ov);
    if (catSel) {
      // Типичная гидратация для крепости: берём медиану среди напитков справочника с такой крепостью
      const medianPct = (a) => { const v = DRINKS.filter((x) => x.cat === "alc" && x.a === a).map((x) => x.h).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : -95; };
      const sync = () => {
        const isAlc = catSel.value === "alc", inp = $("#dk-pct", ov);
        alcBox.classList.toggle("hidden", !isAlc);
        if (isAlc) inp.value = String(medianPct(alcSel.value)).replace(".", ",");
        else if (numS(inp.value) < 0) inp.value = "90";
        upd();
      };
      catSel.addEventListener("change", sync);
      alcSel.addEventListener("change", sync);
    }
    const cardBtn = $("#dk-card", ov);
    if (cardBtn) cardBtn.addEventListener("click", () => showCard(d, false));
    if (!existing) $("#dk-back", ov).addEventListener("click", showList);
    $("#dk-save", ov).addEventListener("click", () => {
      const r = read();
      if (!(r.ml > 0 && r.ml <= 5000)) { toast("Введите объём от 1 до 5000 мл"); return; }
      if (!Number.isFinite(r.pct) || r.pct < -400 || r.pct > 200) { toast("Гидратация: от −400 до 200 процентов"); return; }
      if (!Number.isFinite(r.caf100) || r.caf100 > 1000) { toast("Кофеин: от 0 до 1000 мг на 100 мл"); return; }
      lsSet(`dml:${d.id}`, String(r.ml));
      if (isWater) { changeWater(Math.round(r.ml)); ov.close(); return; }
      // Новый свой напиток: категория, крепость и (по желанию) сохранение карточки в список
      let did = d.id, alcLabel = d.a;
      if (isCustom && !existing) {
        const cat = $("#dk-cat", ov).value;
        alcLabel = cat === "alc" ? $("#dk-alc", ov).value : "";
        const keep = $("#dk-keep", ov);
        if (keep && keep.checked) {
          if (!$("#dk-name", ov).value.trim()) { toast("Введите название напитка"); return; }
          did = newDrinkId();
          const item = { id: did, n: r.name, h: r.pct, c: Math.round(((r.caf100 * 240) / 100) * 10) / 10, cat, a: alcLabel, k: r.nutr.kcal || 0, p: 0, f: 0, cb: 0 };
          saveSharedDrink(item);
        }
      }
      const data = { drinkId: existing ? existing.drinkId : did, name: r.name, ml: r.ml, pct: r.pct, caf100: r.caf100, alc: existing ? existing.alc || "" : alcLabel };
      if (!existing && r.nutr && r.nutr.kcal > 0) {
        // Напиток с калориями: одна запись в дневнике еды, она же считается жидкостью и кофеином (без двойного учёта)
        const per100 = { kcal: r.nutr.kcal, protein: r.nutr.protein, fat: r.nutr.fat, carbs: r.nutr.carbs };
        addDoc(colRef("entries"), {
          date: state.date, meal: $("#dk-meal", ov).value, productId: `drink:${did}`, name: r.name, brand: "",
          grams: r.ml, per100, ...calc(per100, r.ml), drink: { pct: r.pct, caf100: r.caf100 }, createdAt: serverTimestamp(),
        }).catch(writeFail);
        const w = cafToast((r.ml * r.caf100) / 100, 0);
        ov.close();
        toast(w || `Добавлено: ${fmtInt(calc(per100, r.ml).kcal)} ккал и ${fmtInt((r.ml * r.pct) / 100)} мл жидкости`);
        return;
      }
      if (existing) updateDoc(docRef("drinks", existing.id), data).catch(writeFail);
      else addDoc(colRef("drinks"), { ...data, date: state.date, createdAt: serverTimestamp() }).catch(writeFail);
      const warn = cafToast((r.ml * r.caf100) / 100, oldCaf);
      ov.close();
      toast(warn || "Напиток сохранён");
    });
    if (existing) {
      $("#dk-del", ov).addEventListener("click", () => {
        if (!confirm(`Удалить «${existing.name}»?`)) return;
        deleteDoc(docRef("drinks", existing.id)).catch(writeFail);
        ov.close();
        toast("Удалено");
      });
    }
  }

  if (entry) {
    const base = drinkById(entry.drinkId);
    showDetail(entry.drinkId === "custom" || !base
      ? { id: "custom", n: entry.name, h: Number(entry.pct), c: 0, a: "", cat: "other" }
      : { id: base.id, n: entry.name, h: Number(entry.pct), c: (Number(entry.caf100) * 240) / 100, a: entry.alc || "", cat: base.cat }, entry);
  } else if (prefill && prefill.card) showCard({ n: "", h: 90, c: 0, a: "", cat: "other", k: 0, p: 0, f: 0, cb: 0, bc: [], ...prefill }, true, prefill.from);
  else if (presetId && drinkById(presetId)) showDetail(drinkById(presetId));
  else showList();
}

/* ================= Домашние тренировки: план по анкете ================= */
// Отметки «выполнено» хранятся отдельно (users/{uid}/trainlog) и не попадают ни в тренировки, ни в отчёты, ни в ИИ-анализ.
const DUMBBELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';
const trainCfg = () => TR.normCfg(state.trainCfg, todayStr());
const trainLogOn = (d) => state.trainLog.find((x) => x.date === d) || null;
const trainMinutes = (d) => { const l = trainLogOn(d); return l && Number(l.minutes) > 0 ? Number(l.minutes) : trainCfg().minutes; };
const trainSession = (d) => (state.trainCfg ? TR.buildSession(state.trainCfg, d, state.profile, trainMinutes(d), d >= todayStr() ? trainBump() : 0) : null);
function trainProgress(d, ses) {
  const l = trainLogOn(d), done = (l && l.done) || {};
  return { n: ses.items.length, k: ses.items.filter((i) => done[i.key]).length, done };
}
function nextTrainDay(from) {
  const cfg = trainCfg();
  for (let i = 1; i <= 21; i++) { const d = addDays(from, i); if (TR.sessionType(cfg, d)) return d; }
  return null;
}
const trainDayName = (d) => `${TR.DAY_NAMES[TR.dowOf(d)]}, ${dateShort(d)}`;

// Плашка в дневнике: «Сегодня тренировка»
function trainBannerHtml(day) {
  const ses = trainSession(day);
  if (!ses) return "";
  const { n, k } = trainProgress(day, ses);
  const today = todayStr();
  const fin = k >= n || trainFinished(day);
  const head = fin ? "Тренировка выполнена" : day === today ? "Сегодня тренировка" : day < today ? "Тренировка в этот день" : `Тренировка: ${dayLabel(day).toLowerCase()}`;
  return `<button type="button" class="card tr-banner${fin ? " done" : ""}" data-act="goTab" data-tab="health" data-h="train">
    <span class="tr-ban-ic">${DUMBBELL_SVG}</span>
    <span class="tr-ban-main"><b>${head}</b><span>${esc(ses.title)} · около ${ses.est} мин · выполнено ${k} из ${n}</span><span class="track"><i style="width:${n ? Math.round((k / n) * 100) : 0}%"></i></span></span>
    <span class="tr-ban-go">${CHEV_R}</span></button>`;
}

function trainRowHtml(day, it, done) {
  const on = !!done[it.key];
  const sub = it.group === "cardio" || it.group === "warm" ? `${it.text} · ${it.sub}` : `${it.text}${it.vlabel ? ` · ${it.vlabel}` : ""}`;
  return `<div class="tr-row${on ? " on" : ""}">
    <button type="button" class="tr-check" data-act="trainTick" data-date="${day}" data-key="${esc(it.key)}" aria-pressed="${on}" aria-label="Отметить выполненным">${CHECK}</button>
    <button type="button" class="tr-main" data-act="trainOpen" data-date="${day}" data-key="${esc(it.key)}"><span class="tr-name">${esc(it.name)}</span><span class="tr-sub">${esc(sub)}</span></button>
    <button type="button" class="tr-go" data-act="trainOpen" data-date="${day}" data-key="${esc(it.key)}" aria-label="Как выполнять">${CHEV_R}</button>
  </div>`;
}

// Карточка во вкладке «Здоровье → Тренировки»
function trainCardHtml(day) {
  if (!state.trainCfg) {
    return `<section class="card">
      <div class="card-top"><h2 class="h2">План тренировок</h2></div>
      <p class="foot-note" style="margin:0 4px 12px">Составлю план на неделю под ваш инвентарь, время и выбранные дни: разминка, упражнения с рисунками техники, кардио и растяжка. Отметки «выполнено» нужны только вам и в общую статистику тренировок не попадают.</p>
      <button type="button" class="btn primary full" data-act="trainForm">Заполнить анкету</button>
    </section>`;
  }
  const cfg = trainCfg();
  const placeName = TR.PLACES.find((p) => p.v === cfg.place).t.toLowerCase();
  const wk = TR.weekPlan(state.trainCfg, day);
  const today = todayStr();
  const strip = wk.map((d) => {
    let mark = "";
    if (d.type) { const s = trainSession(d.date), p = s && trainProgress(d.date, s); mark = p && p.k >= p.n ? CHECK : "<i></i>"; }
    return `<button type="button" class="tr-d${d.type ? " plan" : ""}${d.date === day ? " sel" : ""}${d.date === today ? " today" : ""}" data-act="pickDay" data-date="${d.date}"><span>${TR.DAY_SHORT[d.dow]}</span><em>${mark}</em></button>`;
  }).join("");
  const ses = trainSession(day);
  let body = "";
  if (ses) {
    const { n, k, done } = trainProgress(day, ses);
    const m = trainMinutes(day);
    const from = TR.movedFrom(cfg, day);
    const groups = [["warm", "Разминка"], ["main", "Основная часть"], ["cardio", "Кардио"], ["cool", "Растяжка"]];
    const rows = groups.map(([g, t]) => {
      const list = ses.items.filter((i) => i.group === g);
      if (!list.length) return "";
      const kk = list.filter((i) => done[i.key]).length;
      const head = `<p class="tr-g"><b>${t}</b><span>${kk}/${list.length}</span></p>`;
      if (g !== "main") return `<div class="tr-blk">${head}<div class="tr-in">${list.map((i) => trainRowHtml(day, i, done)).join("")}</div></div>`;
      // Основная часть разделена по группам мышц: Ноги, Ягодицы, Спина, Бицепс, Трицепс, Кор…
      const order = [];
      list.forEach((i) => { if (!order.includes(i.mg)) order.push(i.mg); });
      return `<div class="tr-blk">${head}<div class="tr-subs">` + order.map((mg) => {
        const part = list.filter((i) => i.mg === mg);
        const k = part.filter((i) => done[i.key]).length;
        return `<div class="tr-mgb"><p class="tr-mg"><b>${esc(TR.MG[mg] || "Другое")}</b><span>${k}/${part.length}</span></p><div class="tr-in">${part.map((i) => trainRowHtml(day, i, done)).join("")}</div></div>`;
      }).join("") + `</div></div>`;
    }).join("");
    body = `
      <div class="tr-top"><div><b class="tr-title">${esc(ses.title)}</b><span class="tr-meta">${esc(trainDayName(day))} · около ${ses.est} мин${from ? ` · перенесено с ${esc(dateShort(from))}` : ""}</span></div>
        <button type="button" class="btn ghost sm" data-act="trainMove" data-date="${day}">Перенести</button></div>
      <p class="tr-lab">Сколько времени на тренировку, мин</p>
      <div class="chips tr-times">${TR.TIMES.map((t) => `<button type="button" class="chip${t === m ? " sel" : " muted"}" data-act="trainMinutes" data-date="${day}" data-v="${t}">${t}</button>`).join("")}</div>
      <div class="track"><i style="width:${n ? Math.round((k / n) * 100) : 0}%"></i></div>
      <p class="foot-note" style="margin:8px 2px 0">${k >= n ? "Тренировка выполнена, отличная работа!" : `Выполнено ${k} из ${n}. Нажмите на кружок, когда упражнение сделано, а на название, чтобы увидеть технику.`}</p>
      <div class="tr-list">${rows}</div>
      ${trainFinished(day) ? `<div class="tr-fin"><b>Тренировка завершена</b><span>${esc(feelLabel(Number((trainLogOn(day) || {}).feel)))}${bandsText(trainLogOn(day)) ? ` · ${esc(bandsText(trainLogOn(day)))}` : ""}</span><button type="button" class="btn ghost sm" data-act="trainFinish" data-date="${day}">Изменить итоги</button></div>` : `<button type="button" class="btn primary full" style="margin-top:14px" data-act="trainFinish" data-date="${day}">Завершить тренировку</button>`}
      ${k > 0 ? `<button type="button" class="more-btn" data-act="trainReset" data-date="${day}">Сбросить отметки за день</button>` : ""}`;
  } else {
    const nx = nextTrainDay(day);
    body = `<p class="foot-note" style="margin:4px 4px 12px">${day === today ? "Сегодня" : "В этот день"} по плану отдых.${nx ? ` Ближайшая тренировка: ${esc(trainDayName(nx))}, ${esc(TR.typeShort(TR.sessionType(cfg, nx)).toLowerCase())}.` : ""}</p>
      <div class="row">${nx ? `<button type="button" class="btn ghost sm" data-act="pickDay" data-date="${nx}">Показать</button>` : ""}<button type="button" class="btn ghost sm" data-act="trainMove" data-date="${day}">Позаниматься в этот день</button></div>`;
  }
  return `<section class="card">
    <div class="card-top"><h2 class="h2">План тренировок</h2><button type="button" class="btn ghost sm" data-act="trainForm">Анкета</button></div>
    <p class="foot-note" style="margin:-4px 4px 10px">${esc(placeName.charAt(0).toUpperCase() + placeName.slice(1))} · ${cfg.days.map((d) => TR.DAY_SHORT[d]).join(", ")} · от ${TR.TIMES[0]} до ${TR.TIMES[TR.TIMES.length - 1]} минут. Отметки только для вас, в статистику не попадают.</p>
    <div class="tr-week">${strip}</div>
    ${body}
  </section>`;
}

const pluralSets = (n) => (n === 1 ? "подход" : "подхода");
function trainDetail(it) {
  if (it.group === "warm" || it.group === "cardio") return `${it.minutes} мин, ${it.sub}.`;
  if (it.group === "cool") return `${it.text}. ${it.sub}.`;
  if (it.reps) return `${it.sets} ${pluralSets(it.sets)} по ${it.reps[0] === it.reps[1] ? it.reps[0] : `${it.reps[0]}–${it.reps[1]}`} повторений${it.side ? " на каждую сторону" : ""}, отдых ${it.rest} сек.`;
  return `${it.sets} ${pluralSets(it.sets)} по ${it.secs[0]}–${it.secs[1]} секунд${it.side ? " на каждую сторону" : ""}, отдых ${it.rest} сек.`;
}

// Окно упражнения: рисунок «старт и финиш», как выполнять, типичные ошибки
function openTrainExercise(date, key) {
  const ses = trainSession(date);
  const it = ses && ses.items.find((i) => i.key === key);
  if (!it) return;
  const ex = TR.EXERCISES[it.id];
  const cfg = trainCfg();
  const isDone = () => !!((trainLogOn(date) || {}).done || {})[key];
  const res = it.vk === "band" || it.vk === "cable"
    ? `<p class="ex-note">Подберите сопротивление так, чтобы последние 2–3 повторения давались тяжело, но техника не ломалась. Когда верхняя граница диапазона даётся легко, возьмите резинку потяжелее или добавьте паузу внизу.</p>`
    : it.vk === "db" ? `<p class="ex-note">Вес гантелей подбирайте так же: последние 2–3 повторения тяжёлые, но техника чистая.${cfg.dumbbellKg ? ` Ваши гантели: ${fmt(cfg.dumbbellKg)} кг. Если легко, замедлите движение: 3 секунды вниз.` : ""}</p>` : "";
  const ov = openSheet(`
    <div class="sheet-head"><h2>${esc(it.name)}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="ex-fig">${TR.illustration(it.id, it.vk)}</div>
    <div class="ex-meta"><span class="pill">${esc(it.vlabel)}</span><span class="pill">${esc(ex.muscles)}</span></div>
    <p class="ex-do"><b>${esc(trainDetail(it))}</b>${it.cue ? ` ${esc(it.cue)}` : ""}</p>
    ${res}
    <h3 class="ex-h">Как выполнять</h3>
    <ol class="ex-list">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <h3 class="ex-h">Частые ошибки</h3>
    <ul class="ex-list ex-bad">${ex.mistakes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p class="foot-note" style="margin:14px 2px 12px">Рисунки схематичные: слева начало движения, справа конец. При боли в суставах, головокружении или боли в груди остановитесь.</p>
    <button type="button" class="btn primary full" id="tx-done">${isDone() ? "Снять отметку" : "Отметить выполненным"}</button>`);
  $("#tx-done", ov).addEventListener("click", () => { actions.trainTick({ date, key }); ov.close(); });
}

// Анкета: место, дни, время, уровень, инвентарь, ограничения
function openTrainForm() {
  const cur = trainCfg();
  const f = { place: cur.place, days: new Set(cur.days), equip: JSON.parse(JSON.stringify(cur.equip)), minutes: cur.minutes, level: cur.level, limits: new Set(cur.limits), kg: cur.dumbbellKg ? String(cur.dumbbellKg).replace(".", ",") : "" };
  const ov = openSheet(`<div class="sheet-head"><h2>Анкета тренировок</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div><div id="tf-body"></div>`);
  const body = $("#tf-body", ov);
  const draw = () => {
    const eq = new Set(f.equip[f.place]);
    const list = TR.EQUIP_BY_PLACE[f.place].map((id) => TR.EQUIP.find((e) => e.id === id));
    const placeHint = { home: "Отметьте, что есть у вас дома.", outdoor: "Отметьте, что вы берёте с собой или что есть на площадке.", gym: "Свободные веса и блоки есть почти в любом зале, отметьте нужное." }[f.place];
    body.innerHTML = `
      <p class="foot-note" style="margin:-4px 2px 12px">После сохранения план на неделю соберётся заново. Анкету можно менять в любой момент.</p>
      <div class="field"><span>Где занимаетесь</span><div class="seg full" data-tf="place">${TR.PLACES.map((p) => `<button type="button" data-v="${p.v}" class="${p.v === f.place ? "on" : ""}">${p.t}</button>`).join("")}</div></div>
      <div class="field"><span>Дни тренировок</span><div class="chips" data-tf="days" style="margin:0">${TR.DAY_SHORT.map((d, i) => `<button type="button" data-v="${i}" class="chip${f.days.has(i) ? " sel" : " muted"}">${d}</button>`).join("")}</div>
        <small class="foot-note" id="tf-days-hint" style="margin:2px 4px 0">${f.days.size === 3 ? "Три дня в неделю: хороший ритм, между тренировками остаётся день отдыха." : f.days.size < 3 ? "Можно и меньше, но три раза в неделю даёт заметно больше." : "Следите за самочувствием: между силовыми тренировками нужен отдых."}</small></div>
      <div class="field"><span>Времени на тренировку, мин</span><div class="chips" data-tf="minutes" style="margin:0">${TR.TIMES.map((t) => `<button type="button" data-v="${t}" class="chip${t === f.minutes ? " sel" : " muted"}">${t}</button>`).join("")}</div>
        <small class="foot-note" style="margin:2px 4px 0">В любой день время можно поменять прямо в плане, упражнения подстроятся.</small></div>
      <div class="field"><span>Уровень</span><div class="seg full" data-tf="level">${TR.TRAIN_LEVELS.map((l) => `<button type="button" data-v="${l.v}" class="${l.v === f.level ? "on" : ""}">${l.t}</button>`).join("")}</div></div>
      <div class="field"><span>Инвентарь · ${placeHint}</span>${list.map((e) => `<label class="check"><input type="checkbox" data-eq="${e.id}" ${eq.has(e.id) ? "checked" : ""}>${esc(e.t)}</label>`).join("")}
        ${eq.has("dumbbell") ? `<label class="field" style="margin-top:6px"><span>Вес гантелей, кг (необязательно)</span><input id="tf-kg" class="input" inputmode="decimal" value="${esc(f.kg)}" autocomplete="off"></label>` : ""}</div>
      <div class="field"><span>Есть ограничения? Такие упражнения заменим</span><div class="chips" data-tf="limits" style="margin:0">${TR.LIMITS.map((l) => `<button type="button" data-v="${l.id}" class="chip${f.limits.has(l.id) ? " sel" : " muted"}">${l.t}</button>`).join("")}</div></div>
      <div class="warn" style="margin:0 0 14px">Это общий ориентир для здоровых взрослых, а не лечебная программа. При болезнях сердца, травмах, беременности и других состояниях согласуйте нагрузку с врачом.</div>
      <div class="row"><button type="button" class="btn ghost" data-close>Отмена</button><button type="button" class="btn primary grow" id="tf-save">Сохранить и собрать план</button></div>`;
  };
  draw();
  const toggle = (set, v) => { if (set.has(v)) set.delete(v); else set.add(v); };
  ov.addEventListener("input", (e) => { if (e.target.id === "tf-kg") f.kg = e.target.value; });
  ov.addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.eq;
    if (!id) return;
    const arr = new Set(f.equip[f.place]);
    if (e.target.checked) arr.add(id); else arr.delete(id);
    f.equip[f.place] = TR.EQUIP.map((x) => x.id).filter((x) => arr.has(x));
    draw();
  });
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tf] [data-v]");
    if (b) {
      const grp = b.parentElement.dataset.tf, v = b.dataset.v;
      if (grp === "place") f.place = v;
      else if (grp === "level") f.level = v;
      else if (grp === "minutes") f.minutes = Number(v);
      else if (grp === "days") { const i = Number(v); if (!f.days.has(i) && f.days.size >= 6) return; toggle(f.days, i); }
      else if (grp === "limits") toggle(f.limits, v);
      draw();
      return;
    }
    if (e.target.closest("#tf-save")) {
      if (!f.days.size) { $("#tf-days-hint", ov).textContent = "Выберите хотя бы один день."; return; }
      const kg = num($("#tf-kg", ov) ? $("#tf-kg", ov).value : f.kg);
      const mv = {};
      const keepFrom = addDays(todayStr(), -14);
      for (const [a, b] of Object.entries(cur.moves || {})) if (a >= keepFrom) mv[a] = b;
      setDoc(docRef("settings", "training"), {
        place: f.place, days: [...f.days].sort((a, b) => a - b), equip: f.equip, minutes: f.minutes, level: f.level, limits: [...f.limits],
        dumbbellKg: Number.isFinite(kg) && f.equip[f.place].includes("dumbbell") ? kg : 0,
        startedAt: (state.trainCfg && state.trainCfg.startedAt) || todayStr(), moves: mv, updatedAt: serverTimestamp(),
      }).catch(writeFail);
      ov.close();
    }
  });
}

// Разовый перенос тренировки на другой день этой недели
function openTrainMove(day) {
  const cfg = trainCfg();
  const wk = TR.weekPlan(state.trainCfg, day);
  const has = TR.sessionType(cfg, day);
  const from = TR.movedFrom(cfg, day);
  let opts = "";
  if (has) {
    opts = wk.filter((d) => !d.type).map((d) => `<button type="button" class="btn ghost full" data-from="${day}" data-to="${d.date}">${esc(trainDayName(d.date))}</button>`).join("");
    if (from) opts = `<button type="button" class="btn primary full" data-from="${day}" data-to="${from}">Вернуть на ${esc(trainDayName(from))}</button>` + opts;
  } else {
    opts = wk.filter((d) => d.type).map((d) => `<button type="button" class="btn ghost full" data-from="${d.date}" data-to="${day}">${esc(trainDayName(d.date))}: ${esc(d.title.toLowerCase())}</button>`).join("");
  }
  const ov = openSheet(`
    <div class="sheet-head"><h2>${has ? "Перенести тренировку" : "Позаниматься в этот день"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <p class="foot-note" style="margin:-4px 2px 12px">${has ? "Выберите свободный день этой недели. Перенос действует один раз, расписание в анкете не меняется." : "Выберите тренировку этой недели, которую перенести на этот день. Перенос действует один раз."}</p>
    <div class="tr-moves">${opts || `<p class="foot-note">На этой неделе нет подходящих дней.</p>`}</div>`);
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-from][data-to]");
    if (!b) return;
    const a = b.dataset.from, to = b.dataset.to;
    const mv = { ...(cfg.moves || {}) };
    const base = TR.movedFrom(cfg, a) || a;        // исходная дата тренировки по расписанию
    delete mv[base];
    if (to !== base) mv[base] = to;
    updateDoc(docRef("settings", "training"), { moves: mv }).catch(writeFail);
    state.date = to;
    ov.close();
  });
}

/* ===== Завершение тренировки, анализ выполненного и прогресс ===== */
const feelLabel = (n) => TR.FEEL[n] || "";
const trainFinished = (d) => { const l = trainLogOn(d); return !!(l && l.finished); };
const finishedLogs = () => state.trainLog.filter((l) => l.finished).sort((a, b) => (a.date < b.date ? 1 : -1));
// Две последние тренировки подряд «легко» → чуть больше повторов, подряд «тяжело» → чуть меньше
function trainBump() {
  const f = finishedLogs().slice(0, 2).map((l) => Number(l.feel) || 3);
  if (f.length < 2) return 0;
  if (f.every((x) => x <= 2)) return 2;
  if (f.every((x) => x >= 4)) return -2;
  return 0;
}
const bandsText = (l) => {
  const parts = TR.BAND_COLORS.filter((c) => l.bands && c.id in l.bands).map((c) => `${c.t.toLowerCase()}${l.bands[c.id] ? ` ${fmt(l.bands[c.id])} кг` : ""}`);
  if (l.dumbbellKg) parts.push(`гантели ${fmt(l.dumbbellKg)} кг`);
  return parts.join(", ");
};

// Что было запланировано и что выполнено за последние 4 недели
function trainStats(fromArg, toArg) {
  const cfg = trainCfg(), today = todayStr();
  const from = fromArg || addDays(today, -41);
  const end = toArg && toArg < today ? toArg : today;
  const start = cfg.startedAt > from ? cfg.startedAt : from;
  const ex = {}, weeks = {};
  let planned = 0, plannedDone = 0, days = 0, daysDone = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!TR.sessionType(cfg, d)) continue;
    const l = trainLogOn(d), done = (l && l.done) || {};
    const started = l && (l.finished || Object.values(done).some(Boolean));
    if (d === today && !started) continue;
    let keys;
    if (l && Array.isArray(l.plan)) keys = l.plan;
    else { const s = TR.buildSession(state.trainCfg, d, state.profile, trainMinutes(d), 0); keys = s ? s.items.map((i) => i.key) : []; }
    const wk = TR.mondayOf(d);
    weeks[wk] = weeks[wk] || { plan: 0, done: 0 };
    days++;
    if (l && l.finished) daysDone++;
    for (const key of keys) {
      const [g, id] = key.split(":");
      const ok = !!done[key];
      weeks[wk].plan++; if (ok) weeks[wk].done++;
      planned++; if (ok) plannedDone++;
      if (g !== "main" || !TR.EXERCISES[id]) continue;
      const e = ex[id] = ex[id] || { id, name: TR.EXERCISES[id].name, mg: TR.mgOf(id), plan: 0, done: 0, last: "" };
      e.plan++; if (ok) { e.done++; if (d > e.last) e.last = d; }
    }
  }
  const list = Object.values(ex);
  const byMg = {};
  list.forEach((e) => { (byMg[e.mg] = byMg[e.mg] || []).push(e); });
  // Серия: подряд идущие запланированные тренировки без пропусков
  let streak = 0;
  for (let d = today, n = 0; n < 120 && d >= cfg.startedAt; d = addDays(d, -1), n++) {
    if (!TR.sessionType(cfg, d)) continue;
    if (trainFinished(d)) streak++;
    else if (d !== today) break;
  }
  return { planned, plannedDone, days, daysDone, list, byMg, weeks, streak };
}

// Данные плана тренировок за период для анализа и выводов (отдельно от Apple Health)
function trainPlanData(from, to) {
  if (!state.trainCfg) return null;
  const st = trainStats(from, to);
  const logs = finishedLogs().filter((l) => l.date >= from && l.date <= to).sort((p, q) => (p.date < q.date ? -1 : 1));
  if (!st.planned && !logs.length) return null;
  const feels = logs.map((l) => Number(l.feel)).filter(Boolean);
  const avg = feels.length ? feels.reduce((p, q) => p + q, 0) / feels.length : 0;
  return { st, logs, feels, avg, pct: st.planned ? Math.round((st.plannedDone / st.planned) * 100) : 0 };
}

// Динамика: как меняются выполнение, тяжесть и вес резинок по тренировкам плана (отдельно от Apple Health)
function trainDynCardHtml(day) {
  if (!state.trainCfg) return "";
  const today = todayStr();
  const mon0 = TR.mondayOf(addDays(today, -49));
  const st = trainStats(mon0, today);
  const logs = finishedLogs().sort((p, q) => (p.date < q.date ? -1 : 1));
  if (!st.planned && !logs.length) return "";
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(mon0, i * 7));
  const wk = weeks.map((w) => ({ w, x: st.weeks[w] || { plan: 0, done: 0 } }));
  const bars = wk.map(({ w, x }) => { const p = x.plan ? Math.round((x.done / x.plan) * 100) : 0; return `<div class="col"><div class="${x.plan ? "b" : "b zero"}" style="height:${x.plan ? Math.max(3, p) : 2}%" title="${esc(dateShort(w))}: ${p}%"></div></div>`; }).join("");
  const labels = `<div class="chart-labels">${wk.map(({ w }) => `<span>${esc(dateShort(w).split(" ")[0])}</span>`).join("")}</div>`;
  const last = logs.slice(-12);
  const feelBars = last.map((l) => `<div class="col"><div class="b${Number(l.feel) >= 4 ? " over" : ""}" style="height:${Math.max(8, (Number(l.feel) || 0) * 20)}%" title="${esc(dateShort(l.date))}: ${esc(feelLabel(Number(l.feel)))}"></div></div>`).join("");
  const bandRows = TR.BAND_COLORS.map((c) => {
    const pts = logs.filter((l) => l.bands && l.bands[c.id] > 0).map((l) => l.bands[c.id]);
    if (!pts.length) return "";
    const seq = pts.filter((v, i) => i === 0 || v !== pts[i - 1]).slice(-5);
    const up = pts[pts.length - 1] - pts[0];
    return `<div class="tr-band-r"><i style="--c:${c.hex}"></i><span>${c.t}</span><b>${fmt(pts[pts.length - 1])} кг</b><small>${seq.length > 1 ? seq.map((v) => fmt(v)).join(" → ") + " кг" : "вес не менялся"}${seq.length > 1 ? (up > 0 ? ", растёт" : up < 0 ? ", снижен" : "") : ""}</small></div>`;
  }).join("");
  const wDone = wk.filter(({ x }) => x.plan);
  const cmp = wDone.length >= 2 ? Math.round((wDone[wDone.length - 1].x.done / wDone[wDone.length - 1].x.plan - wDone[0].x.done / wDone[0].x.plan) * 100) : null;
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Тренировки по плану</h2><span class="pill">не из Apple Health</span></div>
    <p class="tr-lab" style="margin-top:0">Выполнение плана по неделям, %</p>
    <div class="chart tr-feel-chart">${bars}</div>${labels}
    <p class="chart-note">${cmp === null ? "Динамика появится, когда будет хотя бы две недели с тренировками." : `С первой недели выполнение ${cmp > 0 ? "выросло" : cmp < 0 ? "снизилось" : "не изменилось"}${cmp ? ` на ${Math.abs(cmp)} п.п.` : ""}.`}</p>
    ${last.length ? `<p class="tr-lab" style="margin-top:14px">Тяжесть последних тренировок</p><div class="chart tr-feel-chart">${feelBars}</div><p class="chart-note">Высота столбика: самочувствие после тренировки (1 — очень легко, 5 — очень тяжело). Красным отмечены тяжёлые.</p>` : `<p class="foot-note" style="margin:12px 4px 0">Тяжесть появится после первой завершённой тренировки.</p>`}
    ${bandRows ? `<p class="tr-lab" style="margin-top:14px">Вес резинок по цветам</p>${bandRows}` : ""}
  </section>`;
}

function trainExRowsHtml(st) {
  const pct = (x, y) => (y ? Math.round((x / y) * 100) : 0);
  return Object.keys(TR.MG).filter((m) => st.byMg[m]).map((m) => {
    const arr = st.byMg[m].sort((p, q) => q.plan - p.plan);
    const sumP = arr.reduce((t, e) => t + e.plan, 0), sumD = arr.reduce((t, e) => t + e.done, 0);
    return `<p class="tr-mg"><b>${esc(TR.MG[m])}</b><span>${sumD} из ${sumP}</span></p>` + arr.map((e) => {
      const p = pct(e.done, e.plan);
      return `<div class="tr-ex"><div class="tr-ex-top"><span>${esc(e.name)}</span><b class="${p <= 50 ? "low" : ""}">${e.done} из ${e.plan}</b></div><div class="track"><i style="width:${p}%"></i></div>${e.last ? `<small>последний раз ${esc(dateShort(e.last))}</small>` : `<small>ещё не выполняли</small>`}</div>`;
    }).join("");
  }).join("");
}

// Отчёты: выполнение и тяжесть тренировок по плану за выбранный период (отдельно от данных Apple Health)
function trainReportHtml(from, to) {
  if (!state.trainCfg) return "";
  const st = trainStats(from, to);
  const logs = finishedLogs().filter((l) => l.date >= from && l.date <= to).sort((p, q) => (p.date < q.date ? -1 : 1));
  if (!st.planned && !logs.length) return "";
  const pct = (x, y) => (y ? Math.round((x / y) * 100) : 0);
  const feels = logs.map((l) => Number(l.feel)).filter(Boolean);
  const avg = feels.length ? feels.reduce((p, q) => p + q, 0) / feels.length : 0;
  const dist = [1, 2, 3, 4, 5].map((v) => ({ v, n: feels.filter((x) => x === v).length }));
  const mx = Math.max(1, ...dist.map((x) => x.n));
  const distRows = dist.map((x) => `<div class="tr-bar"><span>${x.v} ${esc(feelLabel(x.v).toLowerCase())}</span><div class="track"><i style="width:${Math.round((x.n / mx) * 100)}%"></i></div><b>${x.n}</b></div>`).join("");
  const line = logs.slice(-24).map((l) => `<div class="col"><div class="b${Number(l.feel) >= 4 ? " over" : ""}" style="height:${Math.max(8, (Number(l.feel) || 0) * 20)}%" title="${esc(dateShort(l.date))}: ${esc(feelLabel(Number(l.feel)))}"></div></div>`).join("");
  const bandRows = TR.BAND_COLORS.map((c) => {
    const withC = logs.filter((l) => l.bands && c.id in l.bands);
    if (!withC.length) return "";
    const kgs = withC.map((l) => l.bands[c.id]).filter((v) => v > 0);
    const lastKg = kgs.length ? kgs[kgs.length - 1] : 0;
    return `<div class="tr-band-r"><i style="--c:${c.hex}"></i><span>${c.t}</span><b>${withC.length} ${withC.length === 1 ? "тренировка" : "тренировок"}</b><small>${kgs.length ? (Math.min(...kgs) === Math.max(...kgs) ? `${fmt(lastKg)} кг` : `${fmt(Math.min(...kgs))}–${fmt(Math.max(...kgs))} кг, последний ${fmt(lastKg)} кг`) : "вес не указан"}</small></div>`;
  }).join("");
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Тренировки по плану</h2><span class="pill">не из Apple Health</span></div>
    <div class="stat-grid">
      <div class="stat"><b>${st.plannedDone} из ${st.planned}</b><span>упражнений выполнено${st.planned ? `, ${pct(st.plannedDone, st.planned)}%` : ""}</span></div>
      <div class="stat"><b>${st.daysDone} из ${st.days}</b><span>тренировок завершено</span></div>
      <div class="stat"><b>${avg ? esc(feelLabel(Math.round(avg))) : "—"}</b><span>тяжесть в среднем${avg ? `, ${fmt(Math.round(avg * 10) / 10)} из 5` : ""}</span></div>
      <div class="stat"><b>${st.streak}</b><span>серия без пропусков</span></div>
    </div>
    ${feels.length ? `<h3 class="ex-h">Тяжесть тренировок</h3>${distRows}<div class="chart tr-feel-chart">${line}</div><p class="chart-note">Высота столбика: самочувствие после тренировки (1 — очень легко, 5 — очень тяжело). Красным отмечены тяжёлые.</p>` : `<p class="foot-note" style="margin:12px 4px 0">Тяжесть появится после того, как вы завершите тренировку и оцените самочувствие.</p>`}
    ${bandRows ? `<h3 class="ex-h">Резинки по цветам</h3>${bandRows}` : ""}
    ${st.list.length ? `<h3 class="ex-h">Выполнение упражнений</h3>${trainExRowsHtml(st)}` : ""}
    <p class="chart-note">Данные только из плана тренировок. С тренировками и активностью из Apple Health они не смешиваются и в их счётчики не входят.</p>
  </section>`;
}

function trainProgressCardHtml() {
  if (!state.trainCfg) return "";
  const st = trainStats();
  const fin = finishedLogs();
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const feels = fin.slice(0, 5).map((l) => Number(l.feel)).filter(Boolean);
  const avg = feels.length ? feels.reduce((a, b) => a + b, 0) / feels.length : 0;
  const empty = !st.planned && !fin.length;
  const wkKeys = Object.keys(st.weeks).sort().slice(-6);
  const wkBars = wkKeys.map((w) => { const x = st.weeks[w]; return `<div class="tr-bar"><span>${esc(dateShort(w))}</span><div class="track"><i style="width:${pct(x.done, x.plan)}%"></i></div><b>${pct(x.done, x.plan)}%</b></div>`; }).join("");
  const mgRows = trainExRowsHtml(st);
  const skipped = st.list.filter((e) => e.plan >= 2 && e.done / e.plan <= 0.5).sort((a, b) => a.done / a.plan - b.done / b.plan).slice(0, 4);
  const last2 = fin.slice(0, 2).map((l) => Number(l.feel) || 3);
  let tip = "Нагрузка в самый раз: держите ритм.";
  if (last2.length < 2) tip = "Завершайте тренировки кнопкой «Завершить тренировку»: после двух оценок приложение начнёт подбирать нагрузку.";
  else if (last2.every((x) => x <= 2)) tip = "Две тренировки подряд были лёгкими. Повторы в следующих планах увеличены, а резинку можно взять потяжелее.";
  else if (last2.every((x) => x >= 4)) tip = "Две тренировки подряд были тяжёлыми. Повторы в следующих планах уменьшены: держите вес и не торопитесь.";
  const hist = fin.slice(0, 5).map((l) => `<div class="tr-h"><b>${esc(trainDayName(l.date))}</b><span>${esc(feelLabel(Number(l.feel)))}${bandsText(l) ? ` · ${esc(bandsText(l))}` : ""}</span></div>`).join("");
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Прогресс тренировок</h2><span class="pill">4–6 недель</span></div>
    ${empty ? `<p class="foot-note" style="margin:0 4px">Пока нет данных. Отмечайте упражнения и завершайте тренировки, и здесь появится анализ.</p>` : `
    <div class="stat-grid">
      <div class="stat"><b>${st.plannedDone} из ${st.planned}</b><span>упражнений выполнено${st.planned ? `, ${pct(st.plannedDone, st.planned)}%` : ""}</span></div>
      <div class="stat"><b>${st.daysDone} из ${st.days}</b><span>тренировок завершено</span></div>
      <div class="stat"><b>${st.streak}</b><span>подряд без пропусков</span></div>
      <div class="stat"><b>${avg ? esc(feelLabel(Math.round(avg))) : "—"}</b><span>самочувствие в среднем</span></div>
    </div>
    <p class="tr-tip">${esc(tip)}</p>
    ${wkBars ? `<p class="tr-lab" style="margin-top:14px">Выполнено по неделям</p>${wkBars}` : ""}
    ${skipped.length ? `<p class="tr-skip"><b>Чаще всего пропускаете:</b> ${skipped.map((e) => esc(e.name.toLowerCase())).join(", ")}. Если они не подходят, поменяйте инвентарь или ограничения в анкете.</p>` : ""}
    ${mgRows ? `<h3 class="ex-h">Какие упражнения выполнены</h3>${mgRows}` : ""}
    ${hist ? `<h3 class="ex-h">Последние тренировки</h3>${hist}` : ""}`}
    <button type="button" class="more-btn red" data-act="trainResetAll">Сбросить весь прогресс</button>
  </section>`;
}

// Итоги тренировки: самочувствие, инвентарь, резинки по цветам и вес
function openTrainFinish(date) {
  const ses = trainSession(date);
  if (!ses) return;
  const cfg = trainCfg();
  const old = trainLogOn(date) || {};
  const prev = finishedLogs().find((l) => l.date !== date) || {};
  const f = {
    feel: Number(old.feel) || 0,
    used: new Set(Array.isArray(old.used) ? old.used : prev.used || []),
    bands: { ...(old.finished ? old.bands : prev.bands) || {} },
    kg: old.dumbbellKg || cfg.dumbbellKg || "",
  };
  const have = cfg.equip[cfg.place] || [];
  const list = have.map((id) => TR.EQUIP.find((e) => e.id === id)).filter(Boolean);
  const eff = (id) => Number(cfg.bandKg[id]) || TR.BAND_DEFAULT_KG[id] || 0;
  const { k, n } = trainProgress(date, ses);
  const ov = openSheet(`<div class="sheet-head"><h2>Завершить тренировку</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div><div id="fn-body"></div>`);
  const body = $("#fn-body", ov);
  const draw = () => {
    const band = f.used.has("tube") || f.used.has("loop");
    body.innerHTML = `
      <p class="foot-note" style="margin:-4px 2px 12px">Выполнено упражнений: ${k} из ${n}. Итоги нужны, чтобы считать прогресс и подбирать нагрузку.</p>
      <div class="field"><span>Как вы себя чувствуете?</span>
        <div class="tr-feel">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-feel="${v}" class="${f.feel === v ? "on" : ""}"><b>${v}</b><small>${esc(feelLabel(v))}</small></button>`).join("")}</div>
        <small class="foot-note" style="margin:2px 4px 0">1 — совсем легко, 5 — на пределе.</small></div>
      <div class="field"><span>Какой инвентарь использовали</span>
        ${list.map((e) => `<label class="check"><input type="checkbox" data-used="${e.id}" ${f.used.has(e.id) ? "checked" : ""}>${esc(e.t)}</label>`).join("")}</div>
      ${band ? `<div class="field"><span>Резинки: отметьте цвета и поправьте вес, кг (можно несколько)</span>
        <small class="foot-note" style="margin:0 4px 4px">Вес подставлен по типовому набору из 5 трубок: жёлтая 10, красная 15, синяя 20, зелёная 25, чёрная 30 фунтов (4,5 · 6,8 · 9,1 · 11,3 · 13,6 кг). Точные значения зависят от продавца: поправьте один раз, приложение запомнит.</small>
        ${TR.BAND_COLORS.map((c) => {
          const on = c.id in f.bands;
          return `<div class="tr-band${on ? " on" : ""}"><button type="button" data-band="${c.id}" class="tr-dot${on ? " on" : ""}" style="--c:${c.hex}" aria-pressed="${on}" aria-label="${c.t}"></button><span>${c.t}<small>${cfg.bandKg[c.id] ? "ваш вес" : "ориентир"} ${fmt(eff(c.id))} кг</small></span>${on ? `<input class="input" data-bkg="${c.id}" inputmode="decimal" placeholder="вес, кг" value="${f.bands[c.id] ? esc(String(f.bands[c.id]).replace(".", ",")) : esc(String(eff(c.id)).replace(".", ","))}" autocomplete="off">` : ""}</div>`;
        }).join("")}</div>` : ""}
      ${f.used.has("dumbbell") ? `<label class="field"><span>Вес гантелей, кг</span><input id="fn-kg" class="input" inputmode="decimal" value="${esc(String(f.kg).replace(".", ","))}" autocomplete="off"></label>` : ""}
      <div class="row"><button type="button" class="btn ghost" data-close>Отмена</button><button type="button" class="btn primary grow" id="fn-save" ${f.feel ? "" : "disabled"}>Сохранить итоги</button></div>`;
  };
  draw();
  ov.addEventListener("input", (e) => {
    const c = e.target.dataset && e.target.dataset.bkg;
    if (c) { const v = num(e.target.value); f.bands[c] = Number.isFinite(v) ? v : 0; }
    if (e.target.id === "fn-kg") f.kg = e.target.value;
  });
  ov.addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.used;
    if (!id) return;
    if (e.target.checked) f.used.add(id); else f.used.delete(id);
    draw();
  });
  ov.addEventListener("click", (e) => {
    const fb = e.target.closest("[data-feel]");
    if (fb) { f.feel = Number(fb.dataset.feel); draw(); return; }
    const bb = e.target.closest("[data-band]");
    if (bb) { const c = bb.dataset.band; if (c in f.bands) delete f.bands[c]; else f.bands[c] = eff(c); draw(); return; }
    if (!e.target.closest("#fn-save") || !f.feel) return;
    const kg = num(f.kg);
    const useBand = f.used.has("tube") || f.used.has("loop");
    const bands = useBand ? f.bands : {};
    const rec = {
      date, finished: true, finishedAt: Date.now(), feel: f.feel, used: [...f.used], bands,
      dumbbellKg: f.used.has("dumbbell") && Number.isFinite(kg) ? kg : 0,
      plan: ses.items.map((i) => i.key), updatedAt: serverTimestamp(),
    };
    // updateDoc заменяет карты bands целиком, а setDoc с merge — только дополняет
    (trainLogOn(date) ? updateDoc(docRef("trainlog", date), rec) : setDoc(docRef("trainlog", date), rec)).catch(writeFail);
    const kgs = { ...cfg.bandKg };
    for (const [c, v] of Object.entries(bands)) if (v > 0) kgs[c] = v;
    if (JSON.stringify(kgs) !== JSON.stringify(cfg.bandKg)) updateDoc(docRef("settings", "training"), { bandKg: kgs }).catch(writeFail);
    ov.close();
  });
}

async function resetTrainProgress() {
  if (!confirm("Сбросить весь прогресс тренировок? Отметки выполненных упражнений, итоги и оценки самочувствия будут удалены. Анкета и расписание останутся.")) return;
  try {
    const snap = await getDocs(collection(db, "users", state.user.uid, "trainlog"));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    state.trainLog = [];
    render();
  } catch (e) { writeFail(e); }
}

/* ================= Обработчики ================= */
const actions = {
  prevDay() { if (state.date > FLOOR_DATE) { state.date = addDays(state.date, -1); if (state.date < (state.histFrom || state.liveFrom || "0")) loadHistory(addDays(state.date, -60)); render(); } },
  nextDay() { state.date = addDays(state.date, 1); render(); },
  today() { state.date = todayStr(); render(); },
  trainForm() { openTrainForm(); },
  trainFinish(ds) { openTrainFinish(ds.date); },
  trainResetAll() { resetTrainProgress(); },
  trainOpen(ds) { openTrainExercise(ds.date, ds.key); },
  trainMove(ds) { openTrainMove(ds.date); },
  trainTick(ds) {
    const cur = !!((trainLogOn(ds.date) || {}).done || {})[ds.key];
    setDoc(docRef("trainlog", ds.date), { date: ds.date, done: { [ds.key]: !cur }, updatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
  },
  trainMinutes(ds) {
    setDoc(docRef("trainlog", ds.date), { date: ds.date, minutes: Number(ds.v), updatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
  },
  trainReset(ds) { updateDoc(docRef("trainlog", ds.date), { done: {}, updatedAt: serverTimestamp() }).catch(writeFail); },
  pickDay(ds) { if (ds.date >= FLOOR_DATE) { state.date = ds.date; render(); } },
  addFood(ds) { openAddFood(ds.meal); },
  pickMeal() {
    const cur = mealByTime();
    const ov = openSheet(`
      <div class="sheet-head"><h2>Куда добавить?</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
      <div class="meal-pick">${MEALS.map((m) => `<button type="button" class="meal-pick-btn m-${m.id}${m.id === cur ? " cur" : ""}" data-meal="${m.id}"><span class="meal-ic ${m.id}">${m.emoji}</span><span>${m.name}</span></button>`).join("")}</div>`);
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-meal]");
      if (!b) return;
      ov.close();
      openAddFood(b.dataset.meal);
    });
  },
  editEntry(ds) { const e = state.entries.find((x) => x.id === ds.id); if (e) openEditEntry(e); },
  newProduct() { newCardFlow({}, null); },
  restoreDrinks() {
    const list = lostDrinks();
    if (!list.length) { toast("Нечего восстанавливать"); return; }
    if (!confirm(`Восстановить напитки (${list.length}): ${list.slice(0, 12).map((d) => d.n).join(", ")}${list.length > 12 ? "…" : ""}?`)) return;
    list.forEach((d) => saveSharedDrink({ ...d, id: d.id || newDrinkId() }));
    toast(`Восстановлено напитков: ${list.length}`);
    render();
  },
  goTab(ds) { state.tab = ds.tab; if (ds.h) { state.hTab = ds.h; lsSet("hTab", ds.h); } render(); { const sc = document.getElementById("view"); if (sc) sc.scrollTop = 0; } },
  addWater(ds) { const n = Number(ds.ml); if (n > 0) openDrinkSheet(null, null, n); else openRemoveSheet(); },
  addDrink() { openDrinkSheet(); },
  macroTop(ds) { openMacroTop(ds.key); },
  setTheme(ds) { lsSet("theme", ds.v); applyTheme(); render(); },
  addWeight() { openWeight(); },
  healthTab(ds) { state.hTab = ds.v; lsSet("hTab", ds.v); render(); const v = $("#view"); if (v) v.scrollTop = 0; },
  wtRange(ds) { state.wtRange = Number(ds.v); lsSet("wtRange", ds.v); render(); },
  toggleCafInfo() { state.cafInfo = !state.cafInfo; render(); },
  toggleMeal(ds) { state.mealOpen[ds.key] = !state.mealOpen[ds.key]; render(); },
  toggleFluid() { state.fluidOpenDay = state.fluidOpenDay === state.date ? null : state.date; render(); },
  quickDrink(ds) { openDrinkSheet(null, ds.did); },
  editFluid(ds) {
    if (ds.kind === "food") { const e = state.entries.find((x) => x.id === ds.id); if (e) openEditEntry(e); }
    else { const x = state.drinks.find((y) => y.id === ds.id); if (x) openDrinkSheet(x); }
  },
  waterCustom() { openDrinkSheet(); },
  addActivity() { openActivitySheet(null); },
  toggleStrength(ds) { const w = state.workouts.find((x) => x.id === ds.id); if (w) updateDoc(docRef("workouts", w.id), { strength: !isStrengthW(w) }).catch(writeFail); },
  editActivity(ds) { const a = state.activity.find((x) => x.id === ds.id); if (a) openActivitySheet(a); },
  openProfile() { openProfile(false); },
  async copyLink(ds) {
    const url = `${baseUrl()}?${ds.q}`;
    toast((await copyText(url)) ? "Ссылка скопирована" : "Не удалось скопировать ссылку");
  },
  scanProduct() { openScanner((code) => processBarcode(code, (p) => openProductForm(p), null)); },
  importStarter() {
    const items = starterMissing();
    if (!items.length) { toast("Все базовые продукты уже добавлены"); return; }
    if (!confirm(`Добавить ${items.length} базовых продуктов в общую базу? Их увидят все пользователи.`)) return;
    const batch = writeBatch(db);
    items.forEach(([name, kcal, protein, fat, carbs, meta]) => {
      batch.set(prodDoc(`s_${fnv(fold(name))}`), {
        name, brand: "", barcode: "", kcal, protein, fat, carbs,
        drink: !!meta, hydrationPct: meta ? meta[0] : 0, caffeineMg100: meta ? meta[1] : 0,
        source: "starter", ...authorFields(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    batch.commit().then(() => toast(`Добавлено продуктов: ${items.length}`)).catch(writeFail);
  },
  repDays(ds) {
    const v = Number(ds.n);
    state.repDays = REP_PRESETS.includes(v) ? v : 7;
    state.repCustom = null;
    render();
    if (state.repDays === 0) loadHistory(FLOOR_DATE);
    else if (state.repDays > HISTORY_DAYS) loadHistory(addDays(todayStr(), -state.repDays));
  },
  repCustom() { openCustomPeriod(); },
  aiRun() { runAi(); },
  aiDelete() {
    state.aiLast = null;
    state.ai = { busy: false, error: "", detail: "" };
    try { localStorage.removeItem("ai_last"); } catch { /* ignore */ }
    if (state.user) deleteDoc(docRef("settings", "ai")).catch(writeFail);
    render();
  },
  reportTab(ds) { state.rTab = ds.v; lsSet("rTab", ds.v); render(); const v = $("#view"); if (v) v.scrollTop = 0; },
  toggleMoreCharts() { state.moreCharts = !state.moreCharts; render(); },
  toggleDay(ds) { state.openDays[ds.d] = !state.openDays[ds.d]; render(); },
  toggleWk(ds) { state.openWks[ds.k] = !state.openWks[ds.k]; render(); },
  openDay(ds) { state.date = ds.d; state.tab = "diary"; render(); const v = $("#view"); if (v) v.scrollTop = 0; },
  toggleIns() { state.insOpen = !state.insOpen; render(); },
  checkStatus() { checkStatus(true); },
  async reloadApp() {
    try {
      if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
      if (navigator.serviceWorker) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map((r) => r.unregister())); }
      await fetch("index.html", { cache: "reload" }).catch(() => {});
    } catch (e) { /* ignore */ }
    location.replace(location.pathname + "?r=" + Date.now());
  },
  aiSetup() { openAiSetup(); },
  aiForgetKey() {
    if (!confirm("Удалить ключ Gemini с этого телефона?")) return;
    try { localStorage.removeItem(AI_KEY); } catch { /* ignore */ }
    aiModelsCache = null;
    render();
  },
  applyPlanGoal() {
    const pl = computePlan(state.profile);
    if (!pl) return;
    setDoc(docRef("settings", "profile"), { goalKcal: pl.kcal, goalProtein: pl.protein, goalFat: pl.fat, goalCarbs: pl.carbs, waterBaseMl: pl.water, planUpdatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
    toast("Цель обновлена по расчёту");
  },
  saveGoal() {
    const g = num($("#goal-input").value);
    if (!(g >= 500 && g <= 10000)) { toast("Введите цель от 500 до 10 000 ккал"); return; }
    const raw = {};
    MEALS.forEach((m) => { const v = num($(`#split-${m.id}`).value); raw[m.id] = Number.isFinite(v) ? v : 0; });
    setDoc(docRef("settings", "profile"), { goalKcal: Math.round(g), mealSplit: normalizeSplit(raw) }, { merge: true }).catch(writeFail);
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

// Свайп по записи дневника: вправо — изменить граммы, влево — удалить
{
  let sw = null, blockUntil = 0;
  const view = $("#view");
  view.addEventListener("touchstart", (e) => {
    const w = e.target.closest(".sw");
    if (!w || e.touches.length !== 1) { sw = null; return; }
    sw = { w, el: w.querySelector(".entry"), x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (!sw) return;
    const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 12) return;
      sw.on = true; sw.el.style.transition = "none";
    }
    sw.dx = Math.max(-140, Math.min(140, dx));
    sw.el.style.transform = `translateX(${sw.dx}px)`;
    sw.w.classList.toggle("go-edit", sw.dx > 0);
    sw.w.classList.toggle("go-del", sw.dx < 0);
    sw.w.classList.toggle("armed", Math.abs(sw.dx) > 90);
  }, { passive: true });
  const end = () => {
    if (!sw) return;
    const { w, el, dx, on } = sw; sw = null;
    if (!on) return;
    blockUntil = Date.now() + 400;
    el.style.transition = "transform .2s ease"; el.style.transform = "";
    setTimeout(() => w.classList.remove("go-edit", "go-del", "armed"), 220);
    const entry = state.entries.find((x) => x.id === w.dataset.sw);
    if (!entry) return;
    if (dx > 90) openEditEntry(entry);
    else if (dx < -90 && confirm(`Удалить «${entry.name}» из дневника?`)) deleteDoc(docRef("entries", entry.id)).catch(writeFail);
  };
  view.addEventListener("touchend", end);
  view.addEventListener("touchcancel", () => { if (sw) { sw.el.style.transform = ""; sw = null; } });
  view.addEventListener("click", (e) => { if (Date.now() < blockUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
}

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
  { const sc = document.getElementById("view"); if (sc) sc.scrollTop = 0; }
  if (state.tab === "me") checkStatus(true);
});

readLinkFromUrl();

// Смена связи: перепроверяем состояние сервера
window.addEventListener("online", () => { if (state.user) checkStatus(true); });
window.addEventListener("offline", () => { if (state.tab === "me") render(); });

// Опечатки в данных не должны ломать интерфейс молча
window.addEventListener("unhandledrejection", (e) => console.error("Необработанная ошибка:", e.reason));

// Запрет масштабирования жестами на iPhone (щипок); двойное касание блокирует touch-action в CSS
["gesturestart", "gesturechange", "gestureend"].forEach((name) => document.addEventListener(name, (e) => e.preventDefault(), { passive: false }));
