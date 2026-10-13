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
import { STARTER } from "./starter.js?v=21";
import { DRINKS, DRINK_CATS, DRINK_BY_ID } from "./drinks.js?v=21";

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
const HISTORY_DAYS = 90; // сколько последних дней подписка держит «вживую»; всё, что старше, подгружается по запросу и никогда не удаляется
const FLOOR_DATE = "2020-01-01"; // нижняя граница для календарей
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
  repCustom: null,
  hist: { entries: [], water: [], activity: [], drinks: [] },
  histFrom: null,
  liveFrom: null,
  histBusy: false,
  prodSearch: "",
  error: "",
  profile: {},
  water: [],
  activity: [],
  drinks: [],
  fav: [],
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
const EMPTY = [];
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
  state.profile = {}; state.water = []; state.activity = []; state.drinks = []; state.fav = []; state.obShown = false;
}

function markReady(name) {
  state.ready[name] = true;
  if (Object.values(state.ready).every(Boolean)) { $("#loading").classList.add("hidden"); runPendingLink(); }
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

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "water"), where("date", ">=", from)), (snap) => {
    state.water = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.water);
    markReady("water"); render();
  }, fail));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "activity"), where("date", ">=", from)), (snap) => {
    state.activity = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.activity);
    markReady("activity"); render();
  }, fail));

  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "drinks"), where("date", ">=", from)), (snap) => {
    state.drinks = snap.docs.map((d) => ({ id: d.id, ...d.data() })).concat(state.hist.drinks);
    markReady("drinks"); render();
  }, fail));

  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "drinks"), (snap) => {
    state.fav = snap.exists() && Array.isArray(snap.data().fav) ? snap.data().fav : [];
    render();
  }, (err) => console.warn("Избранные напитки:", err)));
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
      const names = ["entries", "water", "activity", "drinks"];
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
  for (const k of ["entries", "water", "activity", "drinks"]) for (const x of state[k]) if (x.date && x.date < m) m = x.date;
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
        <span class="e-main"><span class="e-name">${esc(e.name)}</span><span class="e-sub">${fmt(e.grams)} ${e.drink ? "мл" : "г"}${e.drink && e.drink.caf100 > 0 ? `, кофеин ${fmtInt((e.grams * e.drink.caf100) / 100)} мг` : ""}${e.brand ? `, ${esc(e.brand)}` : ""}</span></span>
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
/* ================= Аналитика: период, итоги, выводы, анализ через Gemini ================= */
const REP_PRESETS = [7, 14, 30, 90, 365, 0]; // 0 = за всё время
const presetLabel = (v) => (v === 0 ? "Всё" : v === 365 ? "Год" : `${v} дн.`);
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
  const types = {};
  state.activity.filter((a) => a.date >= days[0] && a.date <= days[days.length - 1]).forEach((a) => {
    const t = types[a.name || a.type] = types[a.name || a.type] || { name: a.name || a.type, n: 0, min: 0, kcal: 0, strength: a.type === "strength" };
    t.n++; t.min += Number(a.minutes) || 0; t.kcal += Number(a.kcal) || 0;
  });
  const actTypes = Object.values(types).sort((a, b) => b.min - a.min);
  const strengthSessions = actTypes.filter((t) => t.strength).reduce((s, t) => s + t.n, 0);

  const overDays = logged.filter((x) => x.kcal > goal * 1.1).length;
  const underDays = logged.filter((x) => x.kcal < goal * 0.7).length;
  return {
    days, per, logged, L, plan, goal, kcalAvg, pAvg, fAvg, cAvg, share, mealKcal, mealTotal, wd, topFoods,
    drinkList, plainWater, alcMl, cafTotal, drinkKcalTotal, hydAvg, hydDays: hydDays.length, targetAvg, normDays,
    cafAvg: cafDays.length ? cafTotal / cafDays.length : 0, cafDays: cafDays.length, cafLim, cafOver,
    actDays: actDays.length, actTotalMin, actTotalKcal, weeks, actTypes, strengthSessions, overDays, underDays,
    burnedAvg: per.length ? actTotalKcal / per.length : 0,
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
  else if (dev > 0) add("warn", `В среднем вы едите ${fmtInt(a.kcalAvg)} ккал в день, это на ${fmtInt(a.kcalAvg - a.goal)} больше цели (${fmtInt(a.goal)}). Дней с перебором более 10%: ${a.overDays}.`);
  else add("info", `В среднем ${fmtInt(a.kcalAvg)} ккал в день, это на ${fmtInt(a.goal - a.kcalAvg)} меньше цели. Дней, когда съедено меньше 70% цели: ${a.underDays}.`);
  if (a.plan) {
    const pr = a.pAvg / a.plan.protein;
    if (pr < 0.85) add("warn", `Белка мало: в среднем ${fmt(a.pAvg)} г при ориентире ${a.plan.protein} г. Белок помогает сохранять мышцы и дольше держит сытость.`);
    else add("good", `Белок в норме: ${fmt(a.pAvg)} г в день при ориентире ${a.plan.protein} г.`);
  }
  const pct = (v) => Math.round(v * 100);
  add("info", `Структура калорий: белки ${pct(a.share.protein)}%, жиры ${pct(a.share.fat)}%, углеводы ${pct(a.share.carbs)}%.`);
  if (a.share.fat > 0.38) add("warn", `Жиров много: ${pct(a.share.fat)}% калорий. Обычный ориентир до 30–35%.`);
  const meals = MEALS.map((m) => ({ m, s: a.mealKcal[m.id] / a.mealTotal })).sort((x, y) => y.s - x.s);
  if (meals[0].s > 0.45) add("info", `Больше всего калорий приходится на «${meals[0].m.name.toLowerCase()}»: ${pct(meals[0].s)}%.`);
  const snack = a.mealKcal.snack / a.mealTotal;
  if (snack > 0.3) add("warn", `Перекусы дают ${pct(snack)}% калорий. Проверьте, не уходят ли туда сладкое и напитки.`);
  const wdAvg = a.wd.map((x) => (x.n ? x.s / x.n : 0));
  const withWd = wdAvg.map((v, i) => ({ v, i })).filter((x) => a.wd[x.i].n >= 2);
  if (withWd.length >= 4) {
    const hi = withWd.reduce((p, c) => (c.v > p.v ? c : p)), lo = withWd.reduce((p, c) => (c.v < p.v ? c : p));
    if (hi.v > lo.v * 1.25) add("info", `Дни недели различаются: больше всего вы едите в ${["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"][hi.i]} (${fmtInt(hi.v)} ккал), меньше всего в ${["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"][lo.i]} (${fmtInt(lo.v)}).`);
  }
  if (a.hydDays) {
    const r = a.hydAvg / a.targetAvg;
    if (r < 0.8) add("warn", `Жидкости не хватает: в среднем ${fmtInt(a.hydAvg)} мл при норме около ${fmtInt(a.targetAvg)} мл. Норма выполнена в ${a.normDays} днях из ${a.days.length}.`);
    else add("good", `Жидкость в порядке: в среднем ${fmtInt(a.hydAvg)} мл при норме около ${fmtInt(a.targetAvg)} мл. Норма выполнена в ${a.normDays} днях из ${a.days.length}.`);
  } else add("info", "Жидкость не записывалась. Добавляйте воду и напитки, чтобы видеть баланс.");
  if (a.drinkKcalTotal > 0 && a.L) {
    const dk = a.drinkKcalTotal / a.L;
    if (dk > a.kcalAvg * 0.1) add("warn", `С напитками вы получаете в среднем ${fmtInt(dk)} ккал в день (${pct(dk / a.kcalAvg)}% рациона). Это легко сократить.`);
    else add("info", `Калории из напитков: в среднем ${fmtInt(dk)} ккал в день.`);
  }
  if (a.alcMl > 0) add("warn", `За период записан алкоголь: ${fmtInt(a.alcMl)} мл. Он обезвоживает и добавляет калории.`);
  if (a.cafTotal > 0) {
    if (a.cafOver) add("warn", `Кофеина больше нормы (${a.cafLim} мг) в ${a.cafOver} днях. В среднем ${fmtInt(a.cafAvg)} мг в день с кофеином.`);
    else add("good", `Кофеин в пределах нормы: в среднем ${fmtInt(a.cafAvg)} мг в день при допустимых ${a.cafLim} мг.`);
  }
  if (a.actTotalMin === 0) add("warn", "Нагрузок за период нет. Даже ежедневная быстрая ходьба 20–30 минут заметно меняет самочувствие и расход калорий.");
  else {
    const perWeek = a.actTotalMin / a.weeks;
    const t = a.plan ? a.plan.weekly : null;
    if (t) add(perWeek >= t.minutes ? "good" : "warn", `Нагрузка: ${fmtInt(perWeek)} мин в неделю при ориентире ${t.minutes} мин. Активных дней: ${a.actDays} из ${a.days.length}.`);
    else add("info", `Нагрузка: ${fmtInt(perWeek)} мин в неделю, активных дней ${a.actDays} из ${a.days.length}.`);
    if (t) {
      const sw = a.strengthSessions / a.weeks;
      if (sw < t.strength * 0.7) add("info", `Силовых тренировок ${fmt(sw)} в неделю при ориентире ${t.strength}.`);
    }
  }
  return out;
}

// ---- Gemini ----
const AI_KEY = "gemini_api_key";
const geminiKey = () => (lsGet(AI_KEY) || "").trim();
const AI_BASE = "https://generativelanguage.googleapis.com/v1beta";
let aiModelsCache = null;

async function geminiModels(key) {
  if (aiModelsCache) return aiModelsCache;
  const r = await fetch(`${AI_BASE}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if (!r.ok) throw await geminiError(r);
  const j = await r.json();
  const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
  const list = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name)
    .filter((n) => /gemini-[\d.]+-flash/.test(n) && !/lite|image|live|tts|audio|thinking|exp|robotics|computer|embedding|learnlm|customtools/.test(n));
  list.sort((a, b) => (/preview/.test(a) - /preview/.test(b)) || (ver(b) - ver(a)) || a.length - b.length); // сначала стабильные, внутри — новее
  aiModelsCache = list.length ? list.slice(0, 3) : ["models/gemini-flash-latest"];
  return aiModelsCache;
}
async function geminiError(r) {
  let msg = "";
  try { const j = await r.json(); msg = (j.error && j.error.message) || ""; } catch { /* ignore */ }
  const e = new Error(msg || `Ошибка ${r.status}`);
  e.status = r.status;
  return e;
}
async function askGemini(prompt) {
  const key = geminiKey();
  if (!key) throw new Error("no-key");
  const models = await geminiModels(key);
  let last = null;
  for (const model of models) {
    try {
      const r = await fetch(`${AI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } }),
      });
      if (!r.ok) throw await geminiError(r);
      const j = await r.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.map((p) => p.text || "").join("").trim();
      if (!text) throw new Error((j.promptFeedback && j.promptFeedback.blockReason) ? `Запрос отклонён: ${j.promptFeedback.blockReason}` : "Пустой ответ");
      return { text, model: model.replace("models/", "") };
    } catch (e) {
      last = e;
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 429) break; // ключ или лимит: другая модель не поможет
    }
  }
  aiModelsCache = null;
  throw last || new Error("Не удалось получить ответ");
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
      минут_всего: a.actTotalMin, активных_дней: a.actDays, минут_в_неделю: r(a.actTotalMin / a.weeks), сожжено_ккал_всего: r(a.actTotalKcal),
      виды: a.actTypes.map((t) => ({ вид: t.name, раз: t.n, мин: t.min, ккал: t.kcal })),
    },
    ...(a.days.length > 120
      ? {
        по_неделям: Array.from({ length: Math.ceil(a.per.length / 7) }, (_, w) => {
          const seg = a.per.slice(w * 7, w * 7 + 7), lg = seg.filter((x) => x.has), hy = seg.filter((x) => x.hyd > 0);
          const av = (arr, f) => (arr.length ? r(arr.reduce((t, x) => t + f(x), 0) / arr.length) : null);
          return [seg[0].d, av(lg, (x) => x.kcal), av(lg, (x) => x.protein), av(hy, (x) => x.hyd), r(seg.reduce((t, x) => t + x.caf, 0) / seg.length), seg.reduce((t, x) => t + x.actMin, 0)];
        }),
        формат_по_неделям: "[дата начала недели, среднее ккал за дни с записями, средние белки г, средняя жидкость мл, средний кофеин мг в день, нагрузка мин за неделю]; null значит записей нет",
      }
      : {
        по_дням: a.per.map((x) => [x.d.slice(5), x.has ? r(x.kcal) : null, x.has ? r(x.protein) : null, x.hyd ? r(x.hyd) : null, r(x.caf), x.actMin]),
        формат_по_дням: "[дата ММ-ДД, ккал, белки г, жидкость мл, кофеин мг, нагрузка мин]; null значит записей нет",
      }),
  };
}
function aiPrompt(a) {
  return `Ты внимательный аналитик питания и образа жизни. Ниже данные из личного дневника здоровья пользователя за период. Напиши по-русски понятные, конкретные выводы: что и как он ест, сколько и что пьёт, сколько кофеина, какая у него нагрузка и как это соотносится с целью.

Требования:
- Опирайся только на данные ниже, называй конкретные числа. Если записей мало или есть пропущенные дни, прямо скажи, что выводы приблизительные.
- Не ставь диагнозы и не назначай лечение. Ты не заменяешь врача. Если в данных видно что-то тревожное (очень низкие калории, много алкоголя, кофеина выше нормы), мягко посоветуй обсудить это со специалистом.
- Пиши простым языком, без воды и без общих фраз про здоровый образ жизни.
- Формат: заголовки второго уровня («## Общая картина», «## Питание», «## Жидкость и напитки», «## Кофеин», «## Нагрузка», «## Что получается хорошо», «## На что обратить внимание», «## План на ближайшую неделю»). Внутри разделов короткие абзацы и списки через «- ». Таблицы не используй. «План на ближайшую неделю»: 3–5 конкретных, выполнимых шагов.
- Раздел «Кофеин» пропусти, если кофеина нет.

Данные (JSON):
${JSON.stringify(aiPayload(a))}`;
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

const aiCacheKey = (days) => `ai:${days[0]}:${days[days.length - 1]}`;
function aiCached(days) { try { return JSON.parse(lsGet(aiCacheKey(days)) || "null"); } catch { return null; } }

function aiCardHtml(days) {
  const key = geminiKey();
  const cached = aiCached(days);
  const stamp = cached ? new Date(cached.ts).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
  if (!key) {
    return `<section class="card ai-card">
      <div class="card-top"><h2 class="h2">Анализ с помощью ИИ</h2><span class="pill">Gemini</span></div>
      <p class="foot-note" style="margin:0 0 12px">Gemini прочитает все данные за выбранный период (еда, напитки, вода, кофеин, нагрузки) и напишет выводы: как вы питаетесь, что пьёте и какая у вас нагрузка. Один раз нужно подключить бесплатный ключ Google AI.</p>
      <button type="button" class="btn primary full" data-act="aiSetup">Подключить Gemini</button>
    </section>`;
  }
  return `<section class="card ai-card">
    <div class="card-top"><h2 class="h2">Анализ с помощью ИИ</h2><span class="pill">Gemini</span></div>
    <div id="ai-out">${cached ? `<div class="ai-text">${mdLite(cached.text)}</div><p class="chart-note">Анализ от ${esc(stamp)}${cached.model ? `, модель ${esc(cached.model)}` : ""}. Это не медицинская рекомендация.</p>` : `<p class="foot-note" style="margin:0 0 12px">Нажмите кнопку: ИИ изучит данные за период ${esc(periodText(days))} и напишет выводы. Сводка по дням без имени и почты отправляется в Google Gemini.</p>`}</div>
    <button type="button" class="btn primary full" id="ai-run" data-act="aiRun">${cached ? "Обновить анализ" : "Проанализировать"}</button>
    <button type="button" class="btn ghost full" style="margin-top:8px" data-act="aiForgetKey">Сменить или удалить ключ</button>
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

let aiBusy = false;
async function runAi() {
  if (aiBusy) return;
  const days = reportDays();
  const a = analyze(days);
  if (a.L === 0 && a.actTotalMin === 0 && a.hydAvg === 0) { toast("За период нет данных для анализа"); return; }
  aiBusy = true;
  const btn = document.getElementById("ai-run");
  const out = document.getElementById("ai-out");
  if (btn) { btn.disabled = true; btn.textContent = "Анализирую…"; }
  if (out) out.insertAdjacentHTML("afterbegin", `<p class="foot-note ai-wait" style="margin:0 0 12px">Gemini читает ваши данные. Обычно это 10–30 секунд.</p>`);
  try {
    const r = await askGemini(aiPrompt(a));
    try { localStorage.setItem(aiCacheKey(days), JSON.stringify({ text: r.text, ts: Date.now(), model: r.model })); } catch { /* ignore */ }
  } catch (e) {
    const m = String(e && e.message || "");
    const s = e && e.status;
    toast(
      s === 400 && /API key/i.test(m) ? "Ключ Gemini не подошёл. Проверьте его и вставьте заново."
        : s === 403 ? "Доступ запрещён: проверьте ключ Gemini."
          : s === 429 ? "Достигнут лимит запросов Gemini. Попробуйте позже."
            : /Failed to fetch|NetworkError|Load failed/i.test(m) ? "Нет связи с Gemini. Проверьте интернет."
              : `Gemini: ${m.slice(0, 120) || "ошибка"}`,
    );
  } finally {
    aiBusy = false;
    render();
  }
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
  const grouped = n > 120;
  const gIdx = grouped ? Array.from({ length: Math.ceil(n / 7) }, (_, i) => i * 7) : null;
  const chartKeys = grouped ? gIdx.map((i) => days[i]) : days;
  const gmap = {};
  if (grouped) gIdx.forEach((i) => { gmap[days[i]] = days.slice(i, i + 7); });
  const gfn = (fn) => (grouped ? (k) => { const v = gmap[k].map(fn).filter((x) => x > 0); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0; } : fn);
  const ggoal = (fn) => (!fn || !grouped ? fn : (k) => Math.max(...gmap[k].map(fn)));
  const kper = grouped ? gIdx.map((i) => { const seg = a.per.slice(i, i + 7).filter((x) => x.has); return { d: days[i], has: seg.length > 0, kcal: seg.length ? seg.reduce((t, x) => t + x.kcal, 0) / seg.length : 0 }; }) : a.per;
  const by = grouped ? "по неделям (среднее)" : "по дням";
  const active = (v) => (!state.repCustom && state.repDays === v ? "on" : "");
  const goalMax = Math.max(state.goal * 1.15, ...kper.map((x) => x.kcal), 1);
  const bars = kper.map((x) => {
    const h = x.has ? Math.max(2, (x.kcal / goalMax) * 100) : 0;
    const cls = !x.has ? "b zero" : x.kcal > state.goal ? "b over" : "b";
    return `<div class="col"><div class="${cls}" style="height:${x.has ? h : 2}%" title="${dayLabel(x.d)}: ${fmtInt(x.kcal)} ккал"></div></div>`;
  }).join("");
  const goalBottom = (state.goal / goalMax) * 100;

  const ins = localInsights(a);
  const insHtml = `<div class="ins">${ins.map((i) => `<div class="in ${i.kind}"><i></i><p>${esc(i.text)}</p></div>`).join("")}</div>`;
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

  return `
    ${pageHead("Статистика", "Отчёты")}
    <div class="seg scroll" role="group" aria-label="Период">
      ${REP_PRESETS.map((v) => `<button type="button" data-act="repDays" data-n="${v}" class="${active(v)}">${presetLabel(v)}</button>`).join("")}
      <button type="button" data-act="repCustom" class="${state.repCustom ? "on" : ""}">Свой</button>
    </div>
    <p class="foot-note rp-range">${esc(periodText(days))} · ${n} дн. · еда записана в ${a.L}${state.histBusy ? " · загружаю историю…" : ""}</p>
    ${aiCardHtml(days)}
    <section class="card">
      <h2 class="h2">Краткие выводы</h2>
      ${insHtml}
    </section>
    <section class="card">
      <h2 class="h2">Итоги периода</h2>
      ${a.L || a.hydDays || a.actTotalMin ? `<div class="stat-grid">
        ${kv("ккал в день", fmtInt(a.kcalAvg), `цель ${fmtInt(a.goal)}`)}
        ${kv("дней с перебором", String(a.overDays), "более 10% к цели")}
        ${kv("жидкость в день", `${fmtInt(a.hydAvg)} мл`, `норма ${fmtInt(a.targetAvg)} мл`)}
        ${kv("дней с нормой воды", `${a.normDays} из ${n}`)}
        ${kv("кофеин в день", `${fmtInt(a.cafAvg)} мг`, `допустимо ${a.cafLim} мг`)}
        ${kv("дней выше нормы кофеина", String(a.cafOver))}
        ${kv("нагрузка в неделю", `${fmtInt(a.actTotalMin / a.weeks)} мин`, plan ? `ориентир ${plan.weekly.minutes}` : "")}
        ${kv("сожжено нагрузкой", `${fmtInt(a.actTotalKcal)} ккал`, `активных дней ${a.actDays}`)}
      </div>` : `<div class="empty"><b>Пока нет данных</b>Запишите еду, воду или нагрузку, и здесь появится статистика.</div>`}
    </section>
    <section class="card">
      <h2 class="h2">Калории ${by}</h2>
      <div class="chart">${bars}<div class="goal" style="bottom:${goalBottom}%"></div></div>
      <div class="chart-labels">${chartLabels(chartKeys)}</div>
      <p class="chart-note">Пунктир: ваша цель ${fmtInt(state.goal)} ккал. Красным отмечены дни с перебором.</p>
    </section>
    ${a.L ? `<section class="card">
      <h2 class="h2">Белки, жиры, углеводы в день</h2>
      <div class="rank">
        ${macroRow("Белки", a.pAvg, plan && plan.protein, "")}
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
    </section>
    <section class="card">
      <h2 class="h2">Что я ем чаще всего</h2>
      ${rankRows(foodRows)}
      <p class="chart-note">Продукты и блюда с наибольшим вкладом в калории.</p>
    </section>` : ""}
    ${barsCard(`Жидкость ${by}`, chartKeys, gfn(hydrationOn), ggoal(waterTarget), "мл", "water")}
    ${drinkRows.length ? `<section class="card"><h2 class="h2">Что я пью</h2>${rankRows(drinkRows)}<p class="chart-note">${a.alcMl > 0 ? `Алкоголь за период: ${fmtInt(a.alcMl)} мл. ` : ""}${a.drinkKcalTotal > 0 ? `Калорий из напитков: ${fmtInt(a.drinkKcalTotal)} ккал.` : ""}</p></section>` : ""}
    ${barsCard(`Кофеин ${by}`, chartKeys, gfn((d) => Math.round(caffeineOn(d))), cafLimit, "мг", "caf", true)}
    ${barsCard(`Нагрузки ${by}`, chartKeys, gfn(actMinutes), null, "мин", "")}
    ${actRows.length ? `<section class="card"><h2 class="h2">Нагрузки по видам</h2>${rankRows(actRows)}</section>` : ""}
    <p class="foot-note" style="margin:6px 4px 0">Все записи хранятся в вашем аккаунте без ограничения по времени. Старые периоды подгружаются при выборе.</p>`;
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
    ${quickCardHtml()}
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
  return { drink: true, hydrationPct: base ? base.h : 90, caffeineMg100: caf, cafGuess };
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

// Найти продукт по штрих-коду: сначала у себя, потом в Open Food Facts, иначе ручной ввод.
async function processBarcode(code, onOwn, onSaved) {
  const own = state.products.find((p) => normBC(p.barcode) === normBC(code));
  if (own) { onOwn(own); return; }
  toast("Ищу в Open Food Facts…");
  const r = await fetchOFF(code);
  if (r.state === "found") openProductForm(null, onSaved, { ...r.data, source: "off", note: OFF_NOTE + drinkNote(r.data) });
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

function previewHtml(per100, grams, info, replaceMg = 0) {
  const zero = `<div class="pv-kcal">0<small>ккал</small></div><div class="pv-macros"><div><b>0</b>белки, г</div><div><b>0</b>жиры, г</div><div><b>0</b>углеводы, г</div></div>`;
  const c = grams > 0 ? calc(per100, grams) : null;
  const base = c ? `<div class="pv-kcal">${fmtInt(c.kcal)}<small>ккал</small></div>
    <div class="pv-macros"><div><b>${fmt(c.protein)}</b>белки, г</div><div><b>${fmt(c.fat)}</b>жиры, г</div><div><b>${fmt(c.carbs)}</b>углеводы, г</div></div>` : zero;
  if (!info) return base;
  const ml = grams > 0 ? grams : 0, eff = (ml * info.pct) / 100, caf = (ml * info.caf100) / 100;
  return `${base}<p class="foot-note" style="margin:10px 0 0">Жидкость: <b>${signed(Math.round(eff))} мл</b> засчитано${caf > 0 ? `. Кофеин: <b>${fmtInt(caf)} мг</b>` : ""}.</p>${caf > 0 ? cafWarnHtml(caf, replaceMg) : ""}`;
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
      openProductForm(null, showDetail, { ...d, source: "off", note: OFF_NOTE + drinkNote(d) });
    }));
  }

  function showDetail(p) {
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
  const drinkBlock = `
    <label class="check"><input type="checkbox" id="pf-drink" ${p.drink ? "checked" : ""} ${dis}><span>Это напиток: считать жидкость и кофеин</span></label>
    <div id="pf-drink-box" class="${p.drink ? "" : "hidden"}">
      <div class="field combo"><span>Похож на (начните печатать или выберите)</span><input id="pf-like" class="input" ${dis} autocomplete="off" placeholder="Например: кола, кофе, айран…"><div id="pf-like-list" class="combo-list hidden"></div></div>
      <div class="field-grid">
        <label class="field"><span>Гидратация, %</span><input id="pf-hyd" class="input" inputmode="decimal" ${dis} value="${p.drink ? val(p.hydrationPct) : ""}" autocomplete="off"></label>
        <label class="field"><span>Кофеин, мг на 100 мл</span><input id="pf-caf" class="input" inputmode="decimal" ${dis} value="${p.drink ? val(p.caffeineMg100) : ""}" autocomplete="off"></label>
      </div>
      <p class="foot-note" style="margin:-4px 2px 12px">Такой продукт, добавленный в дневник, сам засчитается и как еда, и как жидкость с кофеином. Повторно вносить его не нужно.</p>
    </div>`;
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
    ${drinkBlock}
    <div class="row">${ro
      ? `<button type="button" class="btn ghost full" data-close>Закрыть</button>`
      : `${product ? `<button type="button" class="btn danger" id="pf-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="pf-save">Сохранить</button>`}</div>`);

  if (ro) return;

  $("#pf-drink", ov).addEventListener("change", (e) => $("#pf-drink-box", ov).classList.toggle("hidden", !e.target.checked));
  {
    const inp = $("#pf-like", ov), list = $("#pf-like-list", ov);
    const all = DRINKS.slice().sort((a, b) => a.n.localeCompare(b.n, "ru"));
    const render = () => {
      const q = fold(inp.value.trim());
      const hit = all.filter((d) => !q || fold(d.n).includes(q));
      list.innerHTML = hit.length
        ? hit.map((d) => `<button type="button" class="combo-item" data-id="${d.id}"><span>${esc(d.n)}</span><small>${d.h}% · ${d.c} мг</small></button>`).join("")
        : `<div class="combo-empty">Ничего не найдено — введите значения ниже вручную</div>`;
      list.classList.remove("hidden");
    };
    inp.addEventListener("focus", render);
    inp.addEventListener("input", render);
    // pointerdown + preventDefault: список не закрывается до выбора
    list.addEventListener("pointerdown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      const d = DRINK_BY_ID[b.dataset.id];
      if (!d) return;
      inp.value = d.n;
      $("#pf-hyd", ov).value = String(d.h).replace(".", ",");
      $("#pf-caf", ov).value = String(r1((d.c / 240) * 100)).replace(".", ",");
      list.classList.add("hidden");
      inp.blur();
    });
    inp.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 120));
  }

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
    const isDrink = $("#pf-drink", ov).checked;
    let drinkData = { drink: false, hydrationPct: 0, caffeineMg100: 0 };
    if (isDrink) {
      const hyd = numS($("#pf-hyd", ov).value);
      const cafRaw = $("#pf-caf", ov).value.trim();
      const caf = cafRaw === "" ? 0 : num(cafRaw);
      if (!Number.isFinite(hyd) || hyd < -400 || hyd > 200) { toast("Гидратация: число от −400 до 200 процентов"); return; }
      if (!Number.isFinite(caf) || caf > 1000) { toast("Кофеин: от 0 до 1000 мг на 100 мл"); return; }
      drinkData = { drink: true, hydrationPct: hyd, caffeineMg100: caf };
    }
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
const currentPlan = () => computePlan(state.profile);
const waterOn = (d) => (byDateIndex("water").get(d) || EMPTY).reduce((sum, x) => sum + (Number(x.ml) || 0), 0);
const actOn = (d) => byDateIndex("activity").get(d) || EMPTY;
const actMinutes = (d) => actOn(d).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
const actBurned = (d) => actOn(d).reduce((sum, a) => sum + (Number(a.kcal) || 0), 0);
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
    kind: "drink", id: x.id, name: x.name, ml: Number(x.ml) || 0, pct: Number(x.pct) || 0, caf100: Number(x.caf100) || 0, ts: createdMs(x),
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

function favDrinks() {
  const counts = {};
  state.drinks.forEach((x) => { if (x.drinkId && x.drinkId !== "custom" && DRINK_BY_ID[x.drinkId]) counts[x.drinkId] = (counts[x.drinkId] || 0) + 1; });
  const freq = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return [...state.fav, ...freq.filter((id) => !state.fav.includes(id))].slice(0, 8).map((id) => DRINK_BY_ID[id]).filter(Boolean);
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
    <button type="button" class="mini water" data-act="goTab" data-tab="health">
      <span class="mini-top"><span class="mini-ic">${DROP_SVG}</span><span class="mini-label">Жидкость</span></span>
      <span class="mini-val">${fmtInt(ml)}<small>мл</small></span>
      <span class="mini-sub">норма ${fmtInt(tg)} мл</span>
      ${caf.mg > 0 ? `<span class="mini-sub caf ${caf.level}">кофеин ${caf.mg} из ${caf.limit} мг</span>` : ""}
      <span class="mini-bar"><i style="width:${Math.max(0, Math.min(100, (ml / tg) * 100))}%"></i></span>
    </button>
    <button type="button" class="mini act" data-act="goTab" data-tab="health">
      <span class="mini-top"><span class="mini-ic">${PULSE_SVG}</span><span class="mini-label">Нагрузка</span></span>
      <span class="mini-val">${fmtInt(mins)}<small>мин</small></span>
      <span class="mini-sub">сожжено ${fmtInt(burned)} ккал</span>
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
  const wMl = waterOn(day);
  const dHyd = items.filter((i) => i.kind === "drink").reduce((sum, i) => sum + itemHyd(i), 0);
  const fHyd = items.filter((i) => i.kind === "food").reduce((sum, i) => sum + itemHyd(i), 0);
  const parts = [];
  if (wMl) parts.push(`вода ${fmtInt(wMl)} мл`);
  if (Math.round(dHyd)) parts.push(`напитки ${signed(Math.round(dHyd))} мл`);
  if (Math.round(fHyd)) parts.push(`напитки из дневника питания ${signed(Math.round(fHyd))} мл`);
  const caf = caffeineStatus(day);
  const acts = actOn(day).sort((a, b) => createdMs(a) - createdMs(b));
  const mins = actMinutes(day), burned = actBurned(day);
  const wk = weekDays(day);
  const wkMin = wk.reduce((sum, d) => sum + actMinutes(d), 0);
  const wkStr = wk.reduce((sum, d) => sum + actOn(d).filter((a) => a.type === "strength").length, 0);
  const wt = plan ? plan.weekly : { minutes: 150, strength: 2, text: WEEKLY.maintain.text };
  const favs = favDrinks();
  const actRows = acts.map((a) => `
    <button type="button" class="entry" data-act="editActivity" data-id="${esc(a.id)}">
      <span class="e-main"><span class="e-name">${esc(a.name)}</span><span class="e-sub">${fmt(a.minutes)} мин</span></span>
      <span class="e-kcal">${fmtInt(a.kcal)}<small>ккал</small></span>
    </button>`).join("");
  const fluidRows = items.map((i) => `
    <button type="button" class="entry" data-act="editFluid" data-kind="${i.kind}" data-id="${esc(i.id)}">
      <span class="e-main"><span class="e-name">${esc(i.name)}</span><span class="e-sub">${fmt(i.ml)} мл, засчитано ${signed(Math.round(itemHyd(i)))} мл${i.kind === "food" ? ", из дневника питания" : ""}</span></span>
      <span class="e-kcal">${itemCaf(i) > 0 ? fmtInt(itemCaf(i)) : "—"}<small>мг кофеина</small></span>
    </button>`).join("");
  return `
    ${pageHead("Здоровье", dayLabel(day), dayNavButtons(day))}
    ${plan ? "" : fillProfilePrompt}
    <section class="card">
      <div class="card-top"><h2 class="h2">Жидкость</h2><span class="pill">норма ${fmtInt(tg)} мл</span></div>
      <div class="big-line">${fmtInt(ml)}<small>мл засчитано</small></div>
      <div class="track water"><i style="width:${Math.max(0, Math.min(100, (ml / tg) * 100))}%"></i></div>
      <p class="foot-note" style="margin:10px 0 12px">${left > 0 ? `Осталось ${fmtInt(left)} мл.` : "Норма на сегодня выполнена."}${extra ? ` В норму добавлено ${fmtInt(Math.round(extra / 50) * 50)} мл за нагрузку.` : ""}${parts.length ? ` Засчитано: ${parts.join(", ")}.` : ""}</p>
      <div class="chips">
        ${[150, 250, 330, 500].map((n) => `<button type="button" class="chip water" data-act="addWater" data-ml="${n}">+${n}</button>`).join("")}
        <button type="button" class="chip" data-act="waterCustom">Другое</button>
        <button type="button" class="chip muted" data-act="addWater" data-ml="-250">−250</button>
      </div>
      <button type="button" class="btn primary full" data-act="addDrink">+ Напиток</button>
      ${favs.length ? `<p class="foot-note" style="margin:14px 2px 8px">Избранное и частые напитки</p><div class="chips" style="margin:0">${favs.map((d) => `<button type="button" class="chip" data-act="quickDrink" data-did="${d.id}">${esc(d.n)}</button>`).join("")}</div>` : ""}
      ${fluidRows ? `<div class="entries flat">${fluidRows}</div>` : ""}
    </section>
    <section class="card">
      <div class="card-top"><h2 class="h2">Кофеин</h2><span class="pill ${caf.level === "ok" ? "" : caf.level}">${caf.mg} из ${caf.limit} мг</span></div>
      <div class="track caf ${caf.level}"><i style="width:${Math.min(100, caf.ratio * 100)}%"></i></div>
      ${caf.msgs.map((m) => `<div class="warn ${m.lv === "over" ? "over" : ""}">${esc(m.t)}</div>`).join("")}
      <p class="foot-note" style="margin:12px 0 0">Норма для вашего веса (${fmt(userWeight())} кг): до ${caf.limit} мг в сутки и до ${cafDose()} мг за один раз. Это ориентир EFSA для здоровых взрослых. При беременности и кормлении, а также при болезнях сердца или давлении норма ниже, уточните у врача.</p>
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
  const step = days.length <= 7 ? 1 : Math.ceil(days.length / 7);
  return days.map((d, i) => {
    const dt = parseD(d);
    const t = days.length <= 7 ? WD_SHORT[dt.getDay()] : (i % step === 0 ? `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, "0")}` : "");
    return `<span>${t}</span>`;
  }).join("");
}

function barsCard(title, days, valFn, goalFn, unit, cls, overLimit) {
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
    <p class="chart-note">${withData.length ? `В среднем за день с записями: <b>${fmtInt(avg)} ${unit}</b>.` : "Пока нет данных."}${goal > 0 ? ` Пунктир: норма (${fmtInt(goal)} ${unit}).` : ""}${overLimit ? " Красным отмечены дни выше нормы." : ""}</p></section>`;
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
function openDrinkSheet(entry, presetId) {
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
      <input id="dk-q" class="input search" type="search" placeholder="Найти напиток" value="${esc(st.q)}" autocomplete="off">
      ${favs.length ? `<p class="foot-note" style="margin:0 2px 8px">Избранное и частые</p><div class="chips">${favs.map((d) => `<button type="button" class="chip" data-did="${d.id}">${esc(d.n)}</button>`).join("")}</div>` : ""}
      <div class="chips cats" id="dk-cats">${DRINK_CATS.map((c) => `<button type="button" class="chip ${st.cat === c.id ? "sel" : ""}" data-cat="${c.id}">${c.t}</button>`).join("")}</div>
      <div id="dk-list" class="plist"></div>
      <p class="foot-note" style="margin:10px 2px 12px">Кофеин указан на 240 мл (стакан) и пересчитывается на ваш объём. Гидратация показывает, сколько мл жидкости засчитывается на каждые 100 мл напитка. У алкоголя значение отрицательное: он уменьшает баланс жидкости.</p>
      <div class="note">Напитки с калориями (капучино, сок, газировка, алкоголь) добавляются и в жидкость, и в калории дневника одной записью. Напиток из магазина можно добавить по штрих-коду.</div>
      <div class="row"><button type="button" class="btn ghost grow" id="dk-scan">Сканировать код</button><button type="button" class="btn ghost grow" id="dk-custom">+ Свой напиток</button></div>`;
    draw();
    $("#dk-q", ov).addEventListener("input", (e) => { st.q = e.target.value; draw(); });
    $("#dk-scan", ov).addEventListener("click", () => {
      ov.close();
      openAddFood(mealByTime());
      setTimeout(() => { const b = document.querySelector("#af-scan"); if (b) b.click(); }, 250);
    });
    $("#dk-custom", ov).addEventListener("click", () => showDetail({ id: "custom", n: "", h: 90, c: 0, a: "", cat: "other" }));
  }

  function draw() {
    const words = fold(st.q).split(/\s+/).filter(Boolean);
    const list = DRINKS.filter((d) => (st.cat === "all" || d.cat === st.cat) && words.every((w) => fold(d.n).includes(w)))
      .sort((a, b) => (a.id === "water" ? -1 : b.id === "water" ? 1 : a.n.localeCompare(b.n, "ru")));
    $("#dk-list", ov).innerHTML = list.length ? list.map(rowHtml).join("") : `<div class="empty"><b>Ничего не найдено</b>Добавьте свой напиток кнопкой ниже.</div>`;
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
    if (pick && DRINK_BY_ID[pick.dataset.did]) showDetail(DRINK_BY_ID[pick.dataset.did]);
  });

  function showDetail(d, existing) {
    const isCustom = d.id === "custom";
    const isWater = d.id === "water" && !existing;
    const oldCaf = existing ? (Number(existing.ml) * Number(existing.caf100)) / 100 : 0;
    const lastMl = existing ? existing.ml : (Number(lsGet(`dml:${d.id}`)) || 250);
    body.innerHTML = `
      <div class="picked"><div class="p-name">${isCustom ? "Свой напиток" : esc(d.n)}</div>${isCustom ? "" : `<div class="p-sub">${d.a ? `${esc(d.a)}. ` : ""}Гидратация ${d.h}%${d.c > 0 ? `, кофеин ${fmt(d.c)} мг на 240 мл` : ""}</div>`}</div>
      ${isCustom ? `<label class="field"><span>Название</span><input id="dk-name" class="input" maxlength="60" value="${existing ? esc(existing.name) : ""}" autocomplete="off" placeholder="Например, Матэ"></label>
        <div class="field-grid">
          <label class="field"><span>Гидратация, %</span><input id="dk-pct" class="input" inputmode="decimal" value="${String(d.h).replace(".", ",")}" autocomplete="off"></label>
          <label class="field"><span>Кофеин, мг на 100 мл</span><input id="dk-caf" class="input" inputmode="decimal" value="${existing ? String(existing.caf100).replace(".", ",") : "0"}" autocomplete="off"></label>
        </div>
        <label class="field"><span>Калории, ккал на 100 мл (если есть)</span><input id="dk-kcal" class="input" inputmode="decimal" value="0" autocomplete="off"></label>` : ""}
      <label class="field"><span>Объём, мл</span><input id="dk-ml" class="input big" inputmode="decimal" value="${String(lastMl).replace(".", ",")}" autocomplete="off"></label>
      <div class="chips">${[100, 150, 200, 250, 330, 500].map((n) => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join("")}</div>
      <div class="preview" id="dk-prev"></div>
      <div id="dk-kbox" class="hidden">
        <div class="note" id="dk-knote">Попадёт и в жидкость, и в калории дневника одной записью. Повторно вносить как еду не нужно.</div>
        <label class="field"><span>Приём пищи</span><select id="dk-meal" class="input">${MEALS.map((m) => `<option value="${m.id}" ${m.id === mealByTime() ? "selected" : ""}>${m.name}</option>`).join("")}</select></label>
      </div>
      <div class="row">${existing ? `<button type="button" class="btn danger" id="dk-del">Удалить</button>` : `<button type="button" class="btn ghost" id="dk-back">Назад</button>`}<button type="button" class="btn primary grow" id="dk-save">${existing ? "Сохранить" : "Добавить"}</button></div>`;

    const read = () => {
      const ml = num($("#dk-ml", ov).value);
      if (isCustom) {
        const k = num($("#dk-kcal", ov).value);
        return { ml, pct: numS($("#dk-pct", ov).value), caf100: num($("#dk-caf", ov).value), name: $("#dk-name", ov).value.trim() || "Свой напиток", nutr: { kcal: k, protein: 0, fat: 0, carbs: 0 } };
      }
      return { ml, pct: d.h, caf100: r1((d.c / 240) * 100), name: d.n, nutr: { kcal: d.k || 0, protein: d.p || 0, fat: d.f || 0, carbs: d.cb || 0 } };
    };
    const upd = () => {
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
    if (!existing) $("#dk-back", ov).addEventListener("click", showList);
    $("#dk-save", ov).addEventListener("click", () => {
      const r = read();
      if (!(r.ml > 0 && r.ml <= 5000)) { toast("Введите объём от 1 до 5000 мл"); return; }
      if (!Number.isFinite(r.pct) || r.pct < -400 || r.pct > 200) { toast("Гидратация: от −400 до 200 процентов"); return; }
      if (!Number.isFinite(r.caf100) || r.caf100 > 1000) { toast("Кофеин: от 0 до 1000 мг на 100 мл"); return; }
      lsSet(`dml:${d.id}`, String(r.ml));
      if (isWater) { changeWater(Math.round(r.ml)); ov.close(); return; }
      const data = { drinkId: existing ? existing.drinkId : d.id, name: r.name, ml: r.ml, pct: r.pct, caf100: r.caf100, alc: existing ? existing.alc || "" : d.a };
      if (!existing && r.nutr && r.nutr.kcal > 0) {
        // Напиток с калориями: одна запись в дневнике еды, она же считается жидкостью и кофеином (без двойного учёта)
        const per100 = { kcal: r.nutr.kcal, protein: r.nutr.protein, fat: r.nutr.fat, carbs: r.nutr.carbs };
        addDoc(colRef("entries"), {
          date: state.date, meal: $("#dk-meal", ov).value, productId: `drink:${d.id}`, name: r.name, brand: "",
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
    const base = DRINK_BY_ID[entry.drinkId];
    showDetail(entry.drinkId === "custom" || !base
      ? { id: "custom", n: entry.name, h: Number(entry.pct), c: 0, a: "", cat: "other" }
      : { id: base.id, n: entry.name, h: Number(entry.pct), c: (Number(entry.caf100) * 240) / 100, a: entry.alc || "", cat: base.cat }, entry);
  } else if (presetId && DRINK_BY_ID[presetId]) showDetail(DRINK_BY_ID[presetId]);
  else showList();
}

/* ================= Обработчики ================= */
const actions = {
  prevDay() { if (state.date > FLOOR_DATE) { state.date = addDays(state.date, -1); if (state.date < (state.histFrom || state.liveFrom || "0")) loadHistory(addDays(state.date, -60)); render(); } },
  nextDay() { state.date = addDays(state.date, 1); render(); },
  today() { state.date = todayStr(); render(); },
  pickDay(ds) { if (ds.date >= FLOOR_DATE) { state.date = ds.date; render(); } },
  addFood(ds) { openAddFood(ds.meal); },
  editEntry(ds) { const e = state.entries.find((x) => x.id === ds.id); if (e) openEditEntry(e); },
  newProduct() { openProductForm(null); },
  goTab(ds) { state.tab = ds.tab; render(); { const sc = document.getElementById("view"); if (sc) sc.scrollTop = 0; } },
  addWater(ds) { changeWater(Number(ds.ml)); },
  addDrink() { openDrinkSheet(); },
  quickDrink(ds) { openDrinkSheet(null, ds.did); },
  editFluid(ds) {
    if (ds.kind === "food") { const e = state.entries.find((x) => x.id === ds.id); if (e) openEditEntry(e); }
    else { const x = state.drinks.find((y) => y.id === ds.id); if (x) openDrinkSheet(x); }
  },
  waterCustom() { openWaterSheet(); },
  addActivity() { openActivitySheet(null); },
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
  aiSetup() { openAiSetup(); },
  aiForgetKey() {
    if (!confirm("Удалить ключ Gemini с этого телефона?")) return;
    try { localStorage.removeItem(AI_KEY); } catch { /* ignore */ }
    aiModelsCache = null;
    render();
  },
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
  { const sc = document.getElementById("view"); if (sc) sc.scrollTop = 0; }
});

readLinkFromUrl();

// Опечатки в данных не должны ломать интерфейс молча
window.addEventListener("unhandledrejection", (e) => console.error("Необработанная ошибка:", e.reason));

// Запрет масштабирования жестами на iPhone (щипок); двойное касание блокирует touch-action в CSS
["gesturestart", "gesturechange", "gestureend"].forEach((name) => document.addEventListener(name, (e) => e.preventDefault(), { passive: false }));
