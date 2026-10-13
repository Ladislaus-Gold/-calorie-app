// Калории — личный дневник питания. Firebase (вход + база) + GitHub Pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { STARTER } from "./starter.js?v=3";

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
const db = getFirestore(app);

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
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SCAN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>';

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
  ready: { products: false, entries: false, settings: false },
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
const per100Text = (p) => `${fmt(p.kcal)} ккал, Б ${fmt(p.protein)}, Ж ${fmt(p.fat)}, У ${fmt(p.carbs)} на 100 г`;

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
  state.ready = { products: false, entries: false, settings: false };
}

function markReady(name) {
  state.ready[name] = true;
  if (state.ready.products && state.ready.entries && state.ready.settings) $("#loading").classList.add("hidden");
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

  state.unsubs.push(onSnapshot(collection(db, "users", uid, "products"), (snap) => {
    state.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    state.error = "";
    markReady("products"); render();
  }, fail));

  const from = minDate();
  state.unsubs.push(onSnapshot(query(collection(db, "users", uid, "entries"), where("date", ">=", from)), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    markReady("entries"); render();
  }, fail));

  state.unsubs.push(onSnapshot(doc(db, "users", uid, "settings", "profile"), (snap) => {
    const g = snap.exists() ? Number(snap.data().goalKcal) : 0;
    state.goal = g > 0 ? g : 2000;
    markReady("settings"); render();
  }, fail));
}

const colRef = (name) => collection(db, "users", state.user.uid, name);
const docRef = (name, id) => doc(db, "users", state.user.uid, name, id);
const writeFail = (err) => { console.error(err); toast("Не удалось сохранить. Проверьте соединение."); };

/* ================= Отрисовка: общее ================= */
function render() {
  if (!state.user) return;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const views = { diary: viewDiary, products: viewProducts, reports: viewReports, me: viewMe };
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
    <text x="60" y="60" text-anchor="middle" class="d-num">${fmtInt(t.kcal)}</text>
    <text x="60" y="78" text-anchor="middle" class="d-unit">ккал</text></svg>`;
}

/* ================= Дневник ================= */
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
  const barPct = Math.min(100, (t.kcal / state.goal) * 100);
  const legend = [
    ["Белки", "var(--protein)", t.protein, pct(kP)],
    ["Углеводы", "var(--carbs)", t.carbs, pct(kC)],
    ["Жиры", "var(--fat)", t.fat, pct(kF)],
  ].map(([n, c, g, p]) => `<div class="lg-row"><span class="lg-dot" style="background:${c}"></span><span>${n}</span><span class="lg-val">${fmt(g)} г<small>${p}%</small></span></div>`).join("");

  // приёмы пищи
  const mealsHtml = MEALS.map((m) => {
    const items = list.filter((e) => e.meal === m.id).sort((a, b) => createdMs(a) - createdMs(b));
    const mt = sumEntries(items);
    const rows = items.map((e) => `
      <button type="button" class="entry" data-act="editEntry" data-id="${esc(e.id)}">
        <span><span class="e-name">${esc(e.name)}</span><span class="e-sub">${fmt(e.grams)} г${e.brand ? `, ${esc(e.brand)}` : ""}</span></span>
        <span class="e-kcal">${fmtInt(e.kcal)}<small>ккал</small></span>
      </button>`).join("");
    return `<section class="card meal">
      <div class="meal-head">
        <span class="meal-ic ${m.id}">${svgIcon(m.icon)}</span>
        <div><div class="meal-name">${m.name}</div><div class="meal-macros">Б ${fmt(mt.protein)}  Ж ${fmt(mt.fat)}  У ${fmt(mt.carbs)}</div></div>
        <div class="meal-kcal">${fmtInt(mt.kcal)}<small>ккал</small></div>
        <button type="button" class="add-btn" data-act="addFood" data-meal="${m.id}" aria-label="Добавить в «${m.name}»">+</button>
      </div>
      ${rows ? `<div class="entries">${rows}</div>` : ""}
    </section>`;
  }).join("");

  return `
    <header class="topbar">
      <button type="button" class="icon-btn" data-act="prevDay" aria-label="Предыдущий день" ${day <= min ? "disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button type="button" class="day-title" data-act="today">${dayLabel(day)}</button>
      <button type="button" class="icon-btn" data-act="nextDay" aria-label="Следующий день">
        <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </header>
    <section class="card"><div class="week-row">${weekHtml}</div><p class="streak">${streakText}</p></section>
    <section class="card">
      <div class="sum-grid">${donut(t)}<div class="legend">${legend}</div></div>
      <div class="progress">
        <div class="progress-top"><span>${left >= 0 ? `Осталось <b>${fmtInt(left)}</b> ккал` : `Перебор <b>${fmtInt(-left)}</b> ккал`}</span><span>цель ${fmtInt(state.goal)}</span></div>
        <div class="bar ${left < 0 ? "over" : ""}"><i style="width:${barPct}%"></i></div>
      </div>
    </section>
    ${mealsHtml}`;
}

/* ================= Продукты ================= */
const fold = (t) => String(t || "").toLowerCase().replace(/ё/g, "е");
function filterProducts(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return state.products;
  return state.products.filter((p) => {
    const hay = fold(`${p.name} ${p.brand || ""} ${p.barcode || ""}`);
    return words.every((w) => hay.includes(w)); // все слова запроса должны встретиться: «куриная жарен»
  });
}

function productRow(p, attr) {
  const sub = [p.brand, p.barcode].filter(Boolean).map(esc).join(", ");
  return `<button type="button" class="prow" ${attr}="${esc(p.id)}">
    <span><span class="p-name">${esc(p.name)}</span><span class="p-sub">${sub ? `${sub}. ` : ""}Б ${fmt(p.protein)}  Ж ${fmt(p.fat)}  У ${fmt(p.carbs)}</span></span>
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
  return `
    <header class="topbar simple"><h1>Мои продукты</h1>
      <div class="row" style="gap:8px">
        <button type="button" class="icon-btn" data-act="scanProduct" aria-label="Сканировать штрих-код">${SCAN_SVG}</button>
        <button type="button" class="btn primary" style="height:42px" data-act="newProduct">+ Новый</button>
      </div></header>
    <input id="prod-search" class="input search" type="search" placeholder="Название или штрих-код" value="${esc(state.prodSearch)}" autocomplete="off">
    <section class="card" style="padding:6px 14px"><div id="plist" class="plist">${productListHtml()}</div></section>
    ${starterMissing().length ? `<section class="card">
      <h2 class="h2">Базовые продукты</h2>
      <p class="chart-note" style="margin:0 0 12px">Овощи, мясо, рыба, яйца, крупы, молочные продукты и фрукты: ${starterMissing().length} позиций со справочными значениями на 100 г. Многие есть в нескольких видах: сырой, варёный, запечённый, жареный. У жареных значения ориентировочные и уже включают типичное количество масла.</p>
      <button type="button" class="btn ghost full" data-act="importStarter">Добавить в мой список</button>
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
    <header class="topbar simple"><h1>Отчёты</h1></header>
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
    <header class="topbar simple"><h1>Я</h1></header>
    <section class="card"><div class="me-head">${avatar}<div><div class="me-name">${esc(u.displayName || "Без имени")}</div><div class="me-mail">${esc(u.email || "")}</div></div></div></section>
    <section class="card">
      <h2 class="h2">Дневная цель</h2>
      <label class="field"><span>Калории в день</span><input id="goal-input" class="input" inputmode="numeric" value="${state.goal}" autocomplete="off"></label>
      <button type="button" class="btn primary full" data-act="saveGoal">Сохранить цель</button>
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
      <button type="button" class="btn ghost full" id="sc-manual">Ввести код вручную</button>
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add("noscroll");
  const video = $("video", ov);
  let reader = null;
  let done = false;

  const stop = () => {
    done = true;
    try { reader && reader.reset(); } catch { /* ignore */ }
    try { const st = video.srcObject; st && st.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
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

  loadZXing().then(async (ZX) => {
    if (done) return;
    const hints = new Map();
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128]);
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    reader = new ZX.BrowserMultiFormatReader(hints, 250);
    await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      video,
      (result) => { if (result) finish(result.getText()); },
    );
    if (done) { try { reader.reset(); } catch { /* ignore */ } return; }
    $("#sc-hint", ov).textContent = "Наведите камеру на штрих-код";
  }).catch((err) => {
    if (done) return;
    console.error("Сканер:", err);
    const name = err && err.name;
    $("#sc-hint", ov).textContent = name === "NotAllowedError"
      ? "Нет доступа к камере. Разрешите камеру для этого сайта в настройках телефона или введите код вручную."
      : "Не удалось запустить камеру. Введите код вручную.";
  });
}

// Найти продукт по штрих-коду: сначала у себя, потом в Open Food Facts, иначе ручной ввод.
async function processBarcode(code, onOwn, onSaved) {
  const own = state.products.find((p) => normBC(p.barcode) === normBC(code));
  if (own) { onOwn(own); return; }
  toast("Ищу в Open Food Facts…");
  const r = await fetchOFF(code);
  if (r.state === "found") openProductForm(null, onSaved, { ...r.data, note: OFF_NOTE });
  else if (r.state === "none") openProductForm(null, onSaved, { barcode: code, note: NEW_BC_NOTE });
  else openProductForm(null, onSaved, { barcode: code, note: OFF_FAIL_NOTE });
}

const starterMissing = () => {
  const have = new Set(state.products.map((p) => String(p.name).trim().toLowerCase()));
  return STARTER.filter((x) => !have.has(x[0].toLowerCase()));
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
      <input id="af-q" class="input search" type="search" placeholder="Найти в моих продуктах" value="${esc(q)}" autocomplete="off">
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
        <span><span class="p-name">${esc(d.name)}</span><span class="p-sub">${d.brand ? `${esc(d.brand)}. ` : ""}Б ${fmt(d.protein || 0)}  Ж ${fmt(d.fat || 0)}  У ${fmt(d.carbs || 0)}</span></span>
        <span class="p-kcal">${fmtInt(d.kcal)}<small>ккал / 100 г</small></span></button>`).join("")}</div>
      <button type="button" class="btn ghost full" id="af-back2" style="margin-top:12px">Назад</button>`;
    $("#af-back2", ov).addEventListener("click", showList);
    body.querySelectorAll("[data-off-i]").forEach((b) => b.addEventListener("click", () => {
      const d = res[Number(b.dataset.offI)];
      openProductForm(null, showDetail, { ...d, note: OFF_NOTE });
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
  const p = product || { name: "", brand: "", barcode: "", kcal: "", protein: "", fat: "", carbs: "", ...prefill };
  const note = product ? "" : (prefill.note || "");
  const val = (v) => (v === "" || v == null ? "" : String(v).replace(".", ","));
  const ov = openSheet(`
    <div class="sheet-head"><h2>${product ? "Продукт" : "Новый продукт"}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    <label class="field"><span>Название</span><input id="pf-name" class="input" value="${esc(p.name)}" autocomplete="off" placeholder="Например, Картофель варёный"></label>
    <label class="field"><span>Бренд (необязательно)</span><input id="pf-brand" class="input" value="${esc(p.brand || "")}" autocomplete="off"></label>
    <div class="field"><span>Штрих-код (необязательно)</span>
      <div class="inline"><input id="pf-barcode" class="input" inputmode="numeric" value="${esc(p.barcode || "")}" autocomplete="off"><button type="button" class="icon-btn" id="pf-scan" aria-label="Сканировать штрих-код">${SCAN_SVG}</button></div></div>
    <div class="field"><span>Значения на 100 г</span></div>
    <div class="field-grid">
      <label class="field"><span>Калории, ккал</span><input id="pf-kcal" class="input" inputmode="decimal" value="${val(p.kcal)}" autocomplete="off"></label>
      <label class="field"><span>Белки, г</span><input id="pf-protein" class="input" inputmode="decimal" value="${val(p.protein)}" autocomplete="off"></label>
      <label class="field"><span>Жиры, г</span><input id="pf-fat" class="input" inputmode="decimal" value="${val(p.fat)}" autocomplete="off"></label>
      <label class="field"><span>Углеводы, г</span><input id="pf-carbs" class="input" inputmode="decimal" value="${val(p.carbs)}" autocomplete="off"></label>
    </div>
    <div class="row">${product ? `<button type="button" class="btn danger" id="pf-del">Удалить</button>` : ""}<button type="button" class="btn primary grow" id="pf-save">Сохранить</button></div>`);

  $("#pf-scan", ov).addEventListener("click", () => openScanner(async (code) => {
    $("#pf-barcode", ov).value = code;
    const dup = state.products.find((x) => normBC(x.barcode) === normBC(code) && (!product || x.id !== product.id));
    if (dup) { toast(`Этот штрих-код уже есть: ${dup.name}`); return; }
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
    const barcode = $("#pf-barcode", ov).value.replace(/\s+/g, "");
    const kcal = num($("#pf-kcal", ov).value);
    const opt = (id) => { const v = $(id, ov).value.trim(); return v === "" ? 0 : num(v); };
    const protein = opt("#pf-protein"), fat = opt("#pf-fat"), carbs = opt("#pf-carbs");
    if (!name) { toast("Введите название"); return; }
    if (!Number.isFinite(kcal)) { toast("Введите калории на 100 г"); return; }
    if ([protein, fat, carbs].some((x) => !Number.isFinite(x))) { toast("Белки, жиры и углеводы: введите число"); return; }
    if (barcode) {
      const dup = state.products.find((x) => x.barcode === barcode && (!product || x.id !== product.id));
      if (dup) { toast(`Этот штрих-код уже есть: ${dup.name}`); return; }
    }
    const data = { name, brand, barcode, kcal, protein, fat, carbs, updatedAt: serverTimestamp() };
    if (product) {
      updateDoc(docRef("products", product.id), data).catch(writeFail);
      ov.close();
      if (onSaved) onSaved({ id: product.id, ...data });
    } else {
      const ref = doc(colRef("products"));
      setDoc(ref, { ...data, createdAt: serverTimestamp() }).catch(writeFail);
      ov.close();
      toast("Продукт сохранён");
      if (onSaved) onSaved({ id: ref.id, ...data });
    }
  });

  if (product) {
    $("#pf-del", ov).addEventListener("click", () => {
      if (!confirm(`Удалить продукт «${product.name}»? Записи в дневнике останутся.`)) return;
      deleteDoc(docRef("products", product.id)).catch(writeFail);
      ov.close();
      toast("Продукт удалён");
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
  scanProduct() { openScanner((code) => processBarcode(code, (p) => openProductForm(p), null)); },
  importStarter() {
    const items = starterMissing();
    if (!items.length) { toast("Все базовые продукты уже добавлены"); return; }
    if (!confirm(`Добавить ${items.length} базовых продуктов в ваш список?`)) return;
    const batch = writeBatch(db);
    items.forEach(([name, kcal, protein, fat, carbs]) => {
      batch.set(doc(colRef("products")), { name, brand: "", barcode: "", kcal, protein, fat, carbs, source: "starter", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
