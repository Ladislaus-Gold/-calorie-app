/* Интерфейс тренировок: план, режим тренировки, упражнения, итоги, прогресс.
   Чистая логика плана и список упражнений лежат в train.js; здесь экраны и работа с журналом тренировок.
   createTrainUI(env) вызывается из app.js один раз, env даёт общие функции приложения (state, render, openSheet и др.). */
import * as TR from "./train.js?v=13";

/* Готовые картинки упражнений (папка img/): `${id}-${vk}-p.webp` профиль, `-f.webp` анфас.
   Есть картинка для пары (упражнение, вариант) — показываем её с переключателем «Профиль / Анфас», иначе рисунок-схему. */
const PHOTOS = new Set(["squat:db"]);
function exFig(id, vk) {
  if (!PHOTOS.has(`${id}:${vk}`)) return TR.illustration(id, vk);
  const b = `img/${id}-${vk}`;
  return `<div class="ex-ph" data-i="0" data-id="${id}" data-vk="${vk}">
    <div class="ex-ph-imgs"><img src="${b}-p.webp" alt="Профиль" decoding="async"><img src="${b}-f.webp" alt="Анфас" decoding="async"></div>
    <div class="ex-ph-dots"><i></i><i></i></div></div>`;
}
// Листание картинок свайпом (scroll-snap), точки показывают текущий вид (профиль / анфас): слушатель на документе, перерисовка ему не мешает
if (typeof document !== "undefined" && !window.__exPh) {
  window.__exPh = true;
  document.addEventListener("scroll", (e) => {
    const s = e.target;
    if (!s || !s.classList || !s.classList.contains("ex-ph-imgs")) return;
    s.parentElement.dataset.i = s.scrollLeft > s.clientWidth / 2 ? "1" : "0";
  }, true);
  // нет файла картинки (например, папка img/ не загружена) — вместо сломанной рамки показываем рисунок-схему
  document.addEventListener("error", (e) => {
    const im = e.target, box = im && im.closest && im.closest(".ex-ph");
    if (box) box.outerHTML = TR.illustration(box.dataset.id, box.dataset.vk);
  }, true);
}

// Звуки тренировки (Web Audio): мягкий сигнал начала отдыха, тройной сигнал «отдых закончен», победная фанфара в конце
let sndCtx = null, sndKeep = null;
function sndUnlock() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    // iPhone: играть как «медиа», тогда беззвучный режим не глушит сигналы
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* ignore */ }
    if (!sndCtx || sndCtx.state === "closed") { sndCtx = new C(); sndKeep = null; }
    if (sndCtx.state !== "running") sndCtx.resume().catch(() => {});
    // «тихий» непрерывный тон: без него iOS усыпляет звук за время отдыха, и сигнал в конце отдыха не слышен
    if (!sndKeep) {
      const o = sndCtx.createOscillator(), g = sndCtx.createGain();
      g.gain.value = 0.00002; o.frequency.value = 40;
      o.connect(g); g.connect(sndCtx.destination); o.start();
      sndKeep = o;
    }
    return sndCtx;
  } catch { return null; }
}
function sndIdle() { try { if (sndKeep) sndKeep.stop(); } catch { /* ignore */ } sndKeep = null; }
function tone(freq, at, dur, vol, type) {
  const c = sndCtx;
  if (!c) return;
  const go = () => {
    try {
      const o = c.createOscillator(), gn = c.createGain(), t = c.currentTime + at;
      o.type = type || "sine"; o.frequency.value = freq;
      o.connect(gn); gn.connect(c.destination);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    } catch { /* ignore */ }
  };
  if (c.state === "running") go(); else c.resume().then(go, () => {});
}
const SND = {
  // отдых начался: два мягких звука вверх
  start() { sndUnlock(); tone(659, 0, 0.2, 0.12); tone(880, 0.13, 0.32, 0.12); },
  // отдых закончился, пора делать подход: три ноты, последняя выше и длиннее
  end() { sndUnlock(); tone(784, 0, 0.16, 0.17, "triangle"); tone(784, 0.2, 0.16, 0.17, "triangle"); tone(1047, 0.4, 0.55, 0.2, "triangle"); },
  // тренировка завершена: «па-бам»
  win() {
    sndUnlock();
    [523, 784].forEach((f) => tone(f, 0, 0.16, 0.15, "triangle"));
    [523, 659, 784, 1047].forEach((f) => tone(f, 0.24, 1.2, 0.13, "triangle"));
    tone(1568, 0.5, 0.9, 0.07, "sine");
  },
};
const CK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1B9D4B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// Кольцо прогресса тренировки: зелёное — сделано, красное — пропущено
function ringSvg(d, done, skip, total, label) {
  const r = d / 2 - 5, c = 2 * Math.PI * r, fs = label.length <= 3 ? 14 : label.length === 4 ? 12 : 11;
  const arc = (from, n, col) => (n > 0 && total > 0 ? `<circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-dasharray="${((c * n) / total).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${((-c * from) / total).toFixed(2)}" transform="rotate(-90 ${d / 2} ${d / 2})"/>` : "");
  return `<div class="wk-ring" style="width:${d}px;height:${d}px"><svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="rgba(27,157,75,.18)" stroke-width="6"/>${arc(0, done, "#1B9D4B")}${arc(done, skip, "#E5484D")}</svg><b style="font-size:${fs}px">${label}</b></div>`;
}

export function createTrainUI(env) {
  const { $, CHECK, CHEV_R, actions, addDays, chev, collection, dateShort, dayLabel, db, docRef, esc, fmt, fmtInt, getDocs, isStrengthW, num, openSheet, render, serverTimestamp, setDoc, state, streak, todayStr, updateDoc, workoutsOn, writeBatch, writeFail } = env;
  // Заголовок упражнения: название крупно, вариант в скобках мельче и серым (одной строкой с названием)
  const lc1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");
  const nameVar = (name, v) => `${esc(name)}${v ? ` <span class="nm-v">(${esc(lc1(v))})</span>` : ""}`;

/* ================= Домашние тренировки: план по анкете ================= */
// Отметки «выполнено» хранятся отдельно (users/{uid}/trainlog) и не попадают ни в тренировки, ни в отчёты, ни в ИИ-анализ.
const DUMBBELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';
const trainCfg = () => TR.normCfg(state.trainCfg, todayStr());
const trainLogOn = (d) => state.trainLog.find((x) => x.date === d) || null;
// Кардио-пункт со временем в минутах (разминка-дорожка или кардио); суставные упражнения разминки идут по секундам
const isMinIt = (it) => it.group === "cardio" || (it.group === "warm" && Number(it.minutes) > 0);
const trainMinutes = (d) => { const l = trainLogOn(d); return l && Number(l.minutes) > 0 ? Number(l.minutes) : trainCfg().minutes; };
// Упражнения с отметкой «болит» минимум в двух разных днях за последние 3 недели заменяются в будущих планах
function painIds(d) {
  const from = addDays(d, -21), days = {};
  for (const l of state.trainLog) if (l.date >= from && l.date < d && l.pain) for (const [id, v] of Object.entries(l.pain)) if (v) (days[id] = days[id] || new Set()).add(l.date);
  return Object.keys(days).filter((id) => days[id].size >= 2);
}
const trainSession = (d, extraAvoid) => {
  if (!state.trainCfg) return null;
  const adv = d >= todayStr() ? trainAdvice(d) : null;
  const avoid = [...(adv ? adv.avoid : []), ...(d >= todayStr() ? painIds(d) : []), ...(((trainLogOn(d) || {}).swapped) || []), ...(extraAvoid || [])];
  const base = TR.buildSession(state.trainCfg, d, state.profile, trainMinutes(d), adv ? adv.bump : 0, avoid);
  const cs = customItems(d);
  if (!cs.length) return base;
  const rank = { warm: 0, main: 1, cardio: 2, cool: 3 };
  const sorted = (arr) => arr.map((x, i) => [x, i]).sort((p, q) => rank[p[0].group] - rank[q[0].group] || p[1] - q[1]).map((x) => x[0]);
  const addMin = Math.round(cs.reduce((s, x) => s + (x.est || 0), 0) / 60);
  if (base) return { ...base, items: sorted([...base.items, ...cs]), est: base.est + addMin };
  const cfg = trainCfg();
  return { date: d, type: "X", minutes: addMin, title: "Своя тренировка", focus: "", items: sorted(cs), bump: 0, swapped: [], est: addMin, sets: 3, level: cfg.level, place: cfg.place, customOnly: true };
};
// Упражнения, которые вы сами добавили в день (отдельно от плана, ведут себя так же)
const customItems = (d) => (((trainLogOn(d) || {}).custom) || []).map((s) => TR.customItem(s, state.trainCfg, d)).filter(Boolean);
// Запись в журнал тренировок с мгновенным обновлением на экране
function mergeLogLocal(date, patch) {
  const i = state.trainLog.findIndex((l) => l.date === date);
  const base = i >= 0 ? state.trainLog[i] : { date };
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) next[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(base[k] || {}), ...v } : v;
  if (i >= 0) state.trainLog[i] = next; else state.trainLog.push(next);
}
function saveTrainLog(date, patch) {
  mergeLogLocal(date, patch);
  return setDoc(docRef("trainlog", date), { date, ...patch, updatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
}
const setsOn = (d, id) => { const x = (((trainLogOn(d) || {}).sets) || {})[id]; return Array.isArray(x) ? x.map((v) => Number(v) || 0) : []; };
// История упражнения: подходы, резинка, суммарные повторы
function exHist(id, date) {
  return state.trainLog.filter((l) => l.date <= date && l.sets && Array.isArray(l.sets[id]) && l.sets[id].some((v) => Number(v) > 0)).sort((p, q) => (p.date < q.date ? -1 : 1)).slice(-8).map((l) => {
    const s = l.sets[id].map((v) => Number(v) || 0);
    const ids = comboIds(((l.ebands) || {})[id]);
    return { date: l.date, sets: s, total: s.reduce((p, q) => p + q, 0), best: Math.max(...s), kg: comboKg(ids), band: bandName(((l.ebands) || {})[id]) };
  });
}
const topReached = (id, date, hi) => { const h = exHist(id, addDays(date, -1)); const last = h[h.length - 1]; return !!(last && hi && last.sets.length && last.sets.every((r) => r >= hi)); };

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
  const eb = ((trainLogOn(day) || {}).ebands || {})[it.id];
  const lg = trainLogOn(day) || {};
  const fm = Number((lg.mins || {})[it.key]) || 0;
  const sd = it.reps ? (((lg.sets || {})[it.id]) || []).filter((v) => Number(v) > 0).length : 0;
  const part = !on && sd > 0 && sd < it.sets ? ` · сделано ${sd} из ${it.sets} подх.` : "";
  const sub = isMinIt(it) ? `${fm ? `${fm} мин (по факту)` : it.text} · ${it.sub}` : `${it.text}${it.vlabel ? ` · ${it.vlabel}` : ""}${eb && bandName(eb) ? ` · ${bandName(eb)}` : ""}${part}`;
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
    const hasC = !d.type && (((trainLogOn(d.date) || {}).custom) || []).length > 0;
    if (d.type || hasC) { const s = trainSession(d.date), p = s && trainProgress(d.date, s); mark = p && p.k >= p.n ? CHECK : "<i></i>"; }
    return `<button type="button" class="tr-d${d.type || hasC ? " plan" : ""}${d.date === day ? " sel" : ""}${d.date === today ? " today" : ""}" data-act="trainDayTap" data-date="${d.date}"><span>${TR.DAY_SHORT[d.dow]}</span><em>${mark}</em></button>`;
  }).join("");
  const ses = trainSession(day);
  let body = "", sum = "";
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
        ${ses.customOnly ? "" : `<button type="button" class="btn ghost sm" data-act="trainMove" data-date="${day}">Перенести</button>`}</div>
      ${ses.customOnly ? "" : `<div class="tr-timerow"><span>Время, мин</span><div class="chips tr-times">${TR.TIMES.map((t) => `<button type="button" class="chip${t === m ? " sel" : " muted"}" data-act="trainMinutes" data-date="${day}" data-v="${t}">${t}</button>`).join("")}</div></div>`}
      <div class="tr-prog"><div class="track"><i style="width:${n ? Math.round((k / n) * 100) : 0}%"></i></div><b>${k}/${n}</b></div>
      ${ses.bump || (ses.swapped && ses.swapped.length) ? `<p class="foot-note tr-adapt" style="margin:8px 2px 0">Подстроено по вашим итогам:${ses.bump ? ` повторы ${ses.bump > 0 ? "+" : "−"}${Math.abs(ses.bump)}` : ""}${ses.swapped && ses.swapped.length ? `${ses.bump ? "," : ""} ${ses.swapped.map((s) => `вместо «${esc(TR.EXERCISES[s.from].name.toLowerCase())}» — «${esc(TR.EXERCISES[s.to].name.toLowerCase())}»`).join(", ")}` : ""}.</p>` : ""}
      ${k >= n ? `<p class="foot-note" style="margin:8px 2px 0">Тренировка выполнена, отличная работа!</p>` : `<button type="button" class="btn primary full" style="margin-top:10px" data-act="trainStart" data-date="${day}">${k > 0 ? "Продолжить тренировку" : "Начать тренировку"}</button>`}
      ${watchCmpHtml(day, ses, k, n)}
      <div class="tr-list">${rows}</div>
      <div class="tr-actions"><button type="button" class="btn ghost full" data-act="trainAdd" data-date="${day}">+ Добавить упражнение</button>
      ${trainFinished(day) ? `<div class="tr-fin"><b>Тренировка завершена</b><span>${esc(feelLabel(Number((trainLogOn(day) || {}).feel)))}${bandsText(trainLogOn(day)) ? ` · ${esc(bandsText(trainLogOn(day)))}` : ""}${ebandsText(trainLogOn(day)) ? `<small class="tr-he">${esc(ebandsText(trainLogOn(day)))}</small>` : ""}</span><button type="button" class="btn ghost sm" data-act="trainFinish" data-date="${day}">Изменить итоги</button> <button type="button" class="btn ghost sm tr-wipe" data-act="trainWipe" data-date="${day}">Удалить итоги</button></div>` : `<button type="button" class="btn primary full" data-act="trainFinish" data-date="${day}">Завершить тренировку</button>`}
      ${k > 0 ? `<button type="button" class="more-btn" data-act="trainReset" data-date="${day}">Сбросить отметки за день</button>` : ""}</div>`;
    sum = `<p class="tr-sum"><b>${esc(ses.title)}</b><span>${esc(trainDayName(day))} · около ${ses.est} мин · выполнено ${k} из ${n}</span></p>`;
  } else {
    const nx = nextTrainDay(day);
    body = `<p class="foot-note" style="margin:4px 4px 12px">${day === today ? "Сегодня" : "В этот день"} по плану отдых.${nx ? ` Ближайшая тренировка: ${esc(trainDayName(nx))}, ${esc(TR.typeShort(TR.sessionType(cfg, nx)).toLowerCase())}.` : ""}</p>
      <div class="row tr-rest">${nx ? `<button type="button" class="btn ghost sm" data-act="trainDayTap" data-date="${nx}">Показать</button>` : ""}<button type="button" class="btn ghost sm" data-act="trainMove" data-date="${day}">${day === today ? "Выполнить сегодня" : "Выполнить"}</button><button type="button" class="btn ghost sm" data-act="trainAdd" data-date="${day}">+ Добавить</button></div>`;
  }
  const open = !!state.trainDayOpen;
  return `<section class="card">
    <div class="card-top"><h2 class="h2${ses ? " tr-tog" : ""}"${ses ? ` data-act="trainDayTog" role="button" aria-expanded="${open}"` : ""}>План тренировок${ses ? `${chev(open)}` : ""}</h2><button type="button" class="btn ghost sm" data-act="trainForm">Анкета</button></div>
    <p class="foot-note" style="margin:-4px 4px 10px">${esc(placeName.charAt(0).toUpperCase() + placeName.slice(1))} · ${cfg.days.map((d) => TR.DAY_SHORT[d]).join(", ")} · ${TR.TIMES[0]}–${TR.TIMES[TR.TIMES.length - 1]} мин</p>
    <div class="tr-week">${strip}</div>
    ${ses && !open ? sum : ""}
    ${ses && !open ? `<p class="foot-note tr-more">Нажмите на «План тренировок» или на стрелку, чтобы раскрыть план</p>` : ""}
    ${ses && !open ? "" : body}
  </section>`;
}

const pluralSets = (n) => (n === 1 ? "подход" : "подхода");
function trainDetail(it) {
  if (isMinIt(it)) return `${it.minutes} мин, ${it.sub}.`;
  if (it.group === "cool" || it.group === "warm") return `${it.text}. ${it.sub}.`;
  if (it.reps) return `${it.sets} ${pluralSets(it.sets)} по ${it.reps[0] === it.reps[1] ? it.reps[0] : `${it.reps[0]}–${it.reps[1]}`} повторений${it.side ? " на каждую сторону" : ""}, отдых ${it.rest} сек.`;
  return `${it.sets} ${pluralSets(it.sets)} по ${it.secs[0]}–${it.secs[1]} секунд${it.side ? " на каждую сторону" : ""}, отдых ${it.rest} сек.`;
}

// Сверка с часами: данные плана и Apple Health остаются раздельными, показываем рядом.
// Ходьба/бег на дорожке, силовая и растяжка/йога записываются часами разными тренировками.
const WALK_RE = /ход|бег|walk|run|дорожк|treadmill|эллипс|вело|cycl/i;
const FLEX_RE = /йог|yoga|растяж|гибк|flex|пилатес|pilates|stretch|mind|cooldown|заминк/i;
const wCat = (w) => (isStrengthW(w) ? "main" : FLEX_RE.test(String(w.name || "")) ? "cool" : WALK_RE.test(String(w.name || "")) ? "walk" : "");
const W_CATS = [["walk", "Ходьба и бег", ["warm", "cardio"]], ["main", "Силовая", ["main"]], ["cool", "Растяжка и йога", ["cool"]]];
function watchCmpHtml(day, ses, k, n) {
  const ws = workoutsOn(day);
  const rows = [], keys = [];
  for (const [cat, title, groups] of W_CATS) {
    const mine = ws.filter((w) => wCat(w) === cat);
    const planned = ses.items.filter((i) => groups.includes(i.group) && !(i.group === "warm" && !(Number(i.minutes) > 0)));
    if (!mine.length) continue;
    const wMin = mine.reduce((t, w) => t + (Number(w.minutes) || 0), 0), wKcal = mine.reduce((t, w) => t + (Number(w.kcal) || 0), 0);
    const pMin = Math.round(planned.reduce((t, i) => t + (i.est || 0), 0) / 60);
    const diff = wMin && pMin ? wMin - pMin : 0;
    const dt = !planned.length ? " · в плане этого нет" : !wMin ? "" : Math.abs(diff) <= 3 ? " · как в плане" : diff > 0 ? ` · на ${diff} мин дольше плана (${pMin})` : ` · на ${-diff} мин короче плана (${pMin})`;
    rows.push(`<div class="tr-wr"><b>${title}</b><span>${wMin ? `${fmtInt(wMin)} мин` : ""}${wKcal ? ` · ${fmtInt(wKcal)} ккал` : ""}${dt}</span></div>`);
    planned.forEach((i) => keys.push(i.key));
  }
  if (!rows.length) return k >= n && day <= todayStr() ? `<p class="foot-note tr-w" style="margin:8px 2px 0">Часы тренировки за этот день не записали (данные из Apple Health приходят примерно каждые 15 минут).</p>` : "";
  const done = (trainLogOn(day) || {}).done || {};
  const todo = keys.filter((x) => !done[x]);
  return `<div class="tr-w"><div class="tr-wh"><b>Часы</b></div>${rows.join("")}${todo.length ? `<button type="button" class="btn ghost sm" data-act="trainMarkAll" data-date="${day}">Отметить по часам (${todo.length})</button>` : ""}</div>`;
}
// Баланс мышц за неделю: подходы запланированные и сделанные по группам
function trainBalanceInner(day) {
  if (!state.trainCfg) return "";
  const wk = TR.weekPlan(state.trainCfg, day), plan = {}, got = {};
  for (const d of wk) {
    if (!d.type) continue;
    const s = trainSession(d.date);
    if (!s) continue;
    const done = (trainLogOn(d.date) || {}).done || {};
    for (const i of s.items) {
      if (i.group !== "main" || !i.mg) continue;
      plan[i.mg] = (plan[i.mg] || 0) + (i.sets || 0);
      if (done[i.key]) got[i.mg] = (got[i.mg] || 0) + (i.sets || 0);
    }
  }
  const ids = Object.keys(plan).sort((p, q) => plan[q] - plan[p]);
  if (!ids.length) return "";
  const today = todayStr();
  const lag = wk.some((d) => d.date < today) ? ids.filter((g) => (got[g] || 0) === 0 && wk.some((d) => d.date < today && d.type)) : [];
  return `<h3 class="ex-h">Баланс мышц за неделю</h3>
    <div class="mb">${ids.map((g) => `<div class="mb-r"><span>${esc(TR.MG[g] || g)}</span><div class="track"><i style="width:${Math.min(100, Math.round(((got[g] || 0) / plan[g]) * 100))}%"></i></div><b>${got[g] || 0}/${plan[g]}</b></div>`).join("")}</div>
    <p class="foot-note" style="margin:10px 2px 0">Подходы основной части: сделано из запланированных на неделю.${lag.length ? ` Пока не тренировали: ${esc(lag.map((g) => (TR.MG[g] || g).toLowerCase()).join(", "))}.` : ""}</p>`;
}

// Режим тренировки: по одному упражнению на весь экран. Подходы плашками: нажал — выполнено, зажал — выбрал число.
// Отдых включается сам (между подходами и перед следующим упражнением): нажатие на таймер +15 с, свайп влево — закончить сразу.
function openTrainWorkout(date) {
  const ses0 = trainSession(date);
  if (!ses0) return;
  const items = ses0.items;
  const isDone = (i) => !!(((trainLogOn(date) || {}).done) || {})[i.key];
  const doneSets = (i) => setsOn(date, i.id).filter((v) => v > 0);
  const factMin = (i) => Number((((trainLogOn(date) || {}).mins) || {})[i.key]) || 0;
  let idx = Math.max(0, items.findIndex((i) => !isDone(i)));
  let setNo = 0, reps = [], phase = "work", endAt = 0, total = 0, tmDone = false, review = false, mins = 0, secv = 0, runStart = 0, retMode = false, winOn = false;
  const skipped = new Set();
  const ov = openSheet(`<div id="wk-root"></div>`);
  ov.querySelector(".sheet").classList.add("wk");
  const root = $("#wk-root", ov);
  sndUnlock();
  let lock = null;
  const getLock = async () => { try { if (navigator.wakeLock && !lock && ov.isConnected) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch { lock = null; } };
  getLock();
  const onVis = () => { if (document.visibilityState === "visible") getLock(); };
  document.addEventListener("visibilitychange", onVis);
  const left = () => Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const startTimer = (sec) => { total = sec; endAt = Date.now() + sec * 1000; tmDone = false; };
  const iv = setInterval(() => {
    if (!ov.isConnected) { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); sndIdle(); try { if (lock) lock.release(); } catch { /* ignore */ } return; }
    const t = $("#wk-t", ov), bar = $("#wk-bar", ov);
    if (!endAt) return;
    const l = left();
    if (t) t.textContent = fmtT(l);
    if (bar && total) bar.style.width = `${Math.round(((total - l) / total) * 100)}%`;
    if (l <= 0 && !tmDone) {
      tmDone = true; endAt = 0; SND.end();
      if (phase === "rest") { phase = "work"; setNo++; draw(); }
      else if (phase === "restx") next();
      else if (phase === "run") finishRun(false);
      else draw();
    }
  }, 250);
  const markDone = (i) => { if (!isDone(i)) saveTrainLog(date, { done: { [i.key]: true } }); };
  // Вход в упражнение: продолжаем с невыполненного подхода; выполненное показываем как «Выполнено» с возможностью повторить
  const enterItem = () => {
    phase = "work"; endAt = 0; tmDone = false; review = false; setNo = 0; reps = [];
    const it = items[idx];
    if (!it) return;
    if (it.reps) {
      const sv = doneSets(it);
      const dn = isDone(it);
      reps = Array.from({ length: it.sets }, (_, i) => (sv[i] > 0 ? sv[i] : sv.length ? sv[sv.length - 1] : it.reps[1]));
      setNo = Math.min(sv.length, it.sets);
      if (sv.length >= it.sets) { markDone(it); review = true; } else if (dn && sv.length === 0) review = true;
    } else {
      mins = factMin(it) || it.minutes || 0;
      secv = it.secs ? it.secs[1] : 0;
      review = isDone(it);
    }
  };
  const next = () => { idx = retMode ? items.length : idx + 1; retMode = false; enterItem(); draw(); };
  const planOf = (x) => (x.reps ? `${x.sets}×${x.reps[1]}` : x.secs ? `${x.secs[1]} сек` : x.minutes ? `${x.minutes} мин` : "");
  const varOf = (x) => { const c = trainCfg(); return [lc1(x.vlabel || ""), x.vk === "db" && c.dumbbellKg ? `${fmt(c.dumbbellKg)} кг` : ""].filter(Boolean).join(" · "); };
  // Шапка: кольцо прогресса (зелёное — сделано, красное — пропущено), название, вариант
  const bandHtml = (title, sub, label) => {
    const n = items.length, dn = items.filter(isDone).length, sk = items.filter((i) => !isDone(i) && skipped.has(i.key)).length;
    return `<div class="wk-band">${ringSvg(52, dn, sk, n, label || `${Math.min(idx + 1, n)}/${n}`)}<div class="wk-bt"><h2 class="wk-name">${esc(title)}</h2>${sub ? `<div class="wk-var">${esc(sub)}</div>` : ""}</div><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>`;
  };
  const ARROW_L = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  const REDO = '<button type="button" class="wk-redo" data-w="redo">↻ Ещё раз</button>';
  const HINT = '<div class="wk-hint" data-g="hint"><i></i><span>Свайпните вверх — подробнее</span></div>';
  const ARROW_R = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  // Силовое упражнение: плашки подходов, отдых, «Следом»
  const strengthHtml = (it) => {
    const n = it.sets, lo = it.reps[0], hi = it.reps[1];
    const dc = review ? n : phase === "work" ? setNo : phase === "rest" ? setNo + 1 : n;
    const cur = review ? -1 : phase === "work" ? setNo : phase === "rest" ? setNo + 1 : -1;
    const prev = exHist(it.id, addDays(date, -1)).slice(-1)[0];
    const plates = reps.slice(0, n).map((v, i) => {
      const dn = i < dc;
      const chip = dn ? (v < lo ? `−${lo - v}` : v > hi ? `+${v - hi}` : "цель") : "";
      return `<div class="wk-pl${dn ? " dn" : ""}${i === cur ? " cur" : ""}" data-g="pl" data-i="${i}"><small>№ ${i + 1}</small><b>${v}</b><em class="${chip[0] === "−" ? "lo" : ""}">${chip}</em>${dn ? `<span class="ck">${CK_SVG}</span>` : ""}</div>`;
    }).join("");
    const nx = items[idx + 1];
    const resting = phase === "rest" || phase === "restx";
    const rc = resting ? `<div class="wk-rc" data-g="rest"><div class="l">${phase === "restx" ? "Отдых перед следующим" : "Отдых"}</div><div class="t" id="wk-t">${fmtT(left())}</div><div class="bar"><i id="wk-bar" style="width:${total ? Math.round(((total - left()) / total) * 100) : 0}%"></i></div><div class="h">нажмите — +15 с · свайп влево — ${phase === "restx" ? "открыть сейчас" : "пропустить"}</div></div>` : "";
    const midTxt = review ? REDO : phase === "work" ? "нажмите — выполнено<br>зажмите — число" : phase === "rest" ? `подход ${setNo + 2} из ${n}<br>начнётся сам` : "следующее<br>откроется само";
    const ctl = `<div class="wk-ctl"><button type="button" class="wk-cb" data-w="prev" aria-label="Назад"${idx === 0 ? " disabled" : ""}>${ARROW_L}</button><div class="wk-mid">${midTxt}</div><button type="button" class="wk-cb sk" data-w="skip" aria-label="Пропустить">${ARROW_R}</button></div>`;
    let nxHtml = "";
    if (nx && phase === "restx") {
      const nex = TR.EXERCISES[nx.id] || {};
      nxHtml = `<div class="wk-nxc"><div class="th">${PHOTOS.has(`${nx.id}:${nx.vk}`) ? `<img src="img/${nx.id}-${nx.vk}-p.webp" alt="">` : nex.frames ? TR.illustration(nx.id, nx.vk) : ""}</div><div><small>Следом</small><div class="n">${esc(nx.name)}</div><div class="v">${esc([varOf(nx), planOf(nx)].filter(Boolean).join(" · "))}</div></div></div>`;
    } else if (nx) {
      nxHtml = `<div class="wk-nx"><small>Следом</small><b>${esc(nx.name)}</b>${varOf(nx) ? `<span>· ${esc(varOf(nx))}</span>` : ""}</div>`;
    }
    return `<div class="wk-info">цель <b>${lo === hi ? hi : `${lo}–${hi}`}</b>${prev ? ` · в прошлый раз <b>${prev.sets.join(" / ")}</b>` : ""}</div><div class="wk-pls">${plates}</div>${rc}${ctl}${nxHtml}${HINT}`;
  };
  // Кардио, разминка, растяжка: одна плашка со значением (минуты или секунды), таймер в той же «карточке», что и отдых
  const simpleHtml = (it) => {
    const kind = isMinIt(it) ? "min" : it.secs ? "sec" : "plain";
    const plan = kind === "min" ? it.minutes : kind === "sec" ? it.secs[1] : 0;
    const val = kind === "min" ? mins : kind === "sec" ? secv : "✓";
    const unit = kind === "min" ? "Минуты" : kind === "sec" ? "Секунды" : "Упражнение";
    const run = phase === "run";
    const chip = review ? "выполнено" : kind === "plain" ? "нажмите" : val === plan ? "цель" : val < plan ? `−${plan - val}` : `+${val - plan}`;
    const pl = `<div class="wk-pl one${review ? " dn" : " cur"}" data-g="pl" data-i="0"><small>${unit}</small><b>${val}</b><em class="${chip[0] === "−" ? "lo" : ""}">${chip}</em>${review ? `<span class="ck">${CK_SVG}</span>` : ""}</div>`;
    const info = kind === "plain" ? esc(trainDetail(it)) : `цель <b>${plan}</b> ${kind === "min" ? "мин" : "сек"}`;
    const len = kind === "min" ? mins * 60 : secv;
    const step = kind === "min" ? "1 мин" : "15 с";
    let rc = "";
    if (!review && kind !== "plain") {
      rc = run
        ? `<div class="wk-rc" data-g="rest"><div class="l">${kind === "min" ? "Идёт" : "Держите"}</div><div class="t" id="wk-t">${fmtT(left())}</div><div class="bar"><i id="wk-bar" style="width:${total ? Math.round(((total - left()) / total) * 100) : 0}%"></i></div><div class="h">нажмите — +${step} · свайп влево — закончить</div></div>`
        : `<div class="wk-rc" data-g="rest"><div class="l">Таймер</div><div class="t">${fmtT(len)}</div><div class="bar"><i style="width:0"></i></div><div class="h">нажмите — запустить</div></div>`;
    }
    const mid = review ? REDO : run ? "идёт таймер<br>закончится сам" : kind === "plain" ? "нажмите — выполнено" : "нажмите — записать<br>зажмите — значение";
    const ctl = `<div class="wk-ctl"><button type="button" class="wk-cb" data-w="prev" aria-label="Назад"${idx === 0 ? " disabled" : ""}>${ARROW_L}</button><div class="wk-mid">${mid}</div><button type="button" class="wk-cb sk" data-w="skip" aria-label="Пропустить">${ARROW_R}</button></div>`;
    const nx = items[idx + 1];
    const nxHtml = nx ? `<div class="wk-nx"><small>Следом</small><b>${esc(nx.name)}</b>${varOf(nx) ? `<span>· ${esc(varOf(nx))}</span>` : ""}</div>` : "";
    return `<div class="wk-info">${info}</div><div class="wk-pls">${pl}</div>${rc}${ctl}${nxHtml}${HINT}`;
  };
  const endHtml = () => {
    const n = items.length, dn = items.filter(isDone).length, sk = n - dn;
    const rows = items.map((x, k) => {
      const d = isDone(x);
      const val = d ? (x.reps ? doneSets(x).join(" / ") : factMin(x) ? `${factMin(x)} мин` : "") : "";
      return `<div class="wk-sr${d ? "" : " no"}"><span class="ic">${d ? "✓" : "→"}</span><span class="nm">${esc(x.name)}</span>${d ? `<span class="v">${esc(val)}</span>` : `<button type="button" class="back" data-w="ret" data-k="${k}">Вернуть</button>`}</div>`;
    }).join("");
    return `${bandHtml("Готово", "", `${n}/${n}`)}<div class="wk-sum"><div class="wk-cnt"><span class="g">${dn} выполнено</span>${sk ? ` · <span class="r">${sk} пропущено</span>` : ""}</div><div class="wk-sl">${rows}</div></div><div class="wk-foot"><button type="button" class="btn primary full" data-w="finish">Завершить тренировку</button><button type="button" class="btn ghost full" data-close style="margin-top:8px">Закрыть</button></div>`;
  };
  const draw = () => {
    if (idx >= items.length) {
      root.classList.remove("wk-str");
      root.innerHTML = endHtml();
      if (!winOn) { winOn = true; SND.win(); }
      return;
    }
    winOn = false;
    const it = items[idx], ex = TR.EXERCISES[it.id] || {};
    const fig = ex.frames ? `<div class="ex-fig wk-fig${PHOTOS.has(`${it.id}:${it.vk}`) ? " wk-ph" : ""}">${exFig(it.id, it.vk)}</div>` : "";
    const eb = ((((trainLogOn(date) || {}).ebands) || {})[it.id]) || lastBand(it.id, date);
    const sub = [varOf(it), eb && (it.vk === "band" || it.vk === "bandf") ? bandName(eb) : ""].filter(Boolean).join(" · ");
    const head = bandHtml(it.name, sub);
    root.classList.add("wk-str");
    root.innerHTML = `${head}${fig}${it.reps ? strengthHtml(it) : simpleHtml(it)}`;
  };
  const recMin = (it, m) => { saveTrainLog(date, { mins: { [it.key]: m }, done: { [it.key]: true } }); next(); };
  // Таймер кардио/растяжки: запуск, конец (сам или свайпом) — значение записывается и открывается следующее
  const startRun = () => {
    const it = items[idx];
    const len = isMinIt(it) ? mins * 60 : secv;
    if (!it || it.reps || review || len <= 0) return;
    phase = "run"; startTimer(len); runStart = Date.now(); SND.start(); draw();
  };
  const finishRun = (early) => {
    const it = items[idx];
    endAt = 0; phase = "work";
    if (!it) return;
    if (isMinIt(it)) recMin(it, early ? Math.max(1, Math.round((Date.now() - runStart) / 60000)) : Math.max(1, Math.round(total / 60)));
    else { markDone(it); next(); }
  };
  const toast = (txt, undo) => {
    ov.querySelectorAll(".wk-toast").forEach((e) => e.remove());
    const t = document.createElement("div");
    t.className = "wk-toast";
    t.innerHTML = `<span>${esc(txt)}</span><u>Отменить</u>`;
    t.querySelector("u").addEventListener("click", () => { t.remove(); undo(); });
    ov.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  };
  // Подход выполнен: сохраняем сразу, дальше сам включается отдых (между подходами или перед следующим упражнением)
  const setDone = () => {
    const it = items[idx];
    saveTrainLog(date, { sets: { [it.id]: reps.slice(0, setNo + 1) } });
    const rest = it.rest || 40;
    if (setNo + 1 >= it.sets) {
      markDone(it);
      if (idx < items.length - 1 && !retMode) { phase = "restx"; startTimer(rest); SND.start(); draw(); } else next();
    } else { phase = "rest"; startTimer(rest); SND.start(); draw(); }
  };
  const restSkip = () => { if (phase === "rest") { endAt = 0; phase = "work"; setNo++; draw(); } else if (phase === "restx") { endAt = 0; next(); } };
  const rest15 = (sec = 15) => {
    if (!endAt) return;
    endAt += sec * 1000; total += sec;
    const rc = $(".wk-rc", ov);
    if (rc) { const b = document.createElement("span"); b.className = "plus"; b.textContent = sec >= 60 ? "+1 мин" : "+15 с"; rc.appendChild(b); setTimeout(() => b.remove(), 900); }
  };
  const doneCount = (it) => (phase === "work" ? setNo : phase === "rest" ? setNo + 1 : it.sets);
  // Выбранное колесом число: для текущей плашки подход сразу засчитывается, для выполненной значение правится
  const pick = (i, v) => {
    const it = items[idx];
    if (!it) return;
    if (!it.reps) { if (isMinIt(it)) mins = v; else secv = v; draw(); return; }
    reps[i] = v;
    if (phase === "work" && i === setNo) { setDone(); return; }
    if (i < doneCount(it)) saveTrainLog(date, { sets: { [it.id]: reps.slice(0, doneCount(it)) } });
    draw();
  };
  ov.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-g]")) e.preventDefault(); });
  let g = null;
  const wheel = (G) => {
    const P = G.picker, rows = [2, 1, 0, -1, -2].map((d) => { const v = P.sel + d * P.step; return `<div class="${d === 0 ? "sel" : Math.abs(d) === 1 ? "m" : ""}">${v >= P.min && v <= P.max ? v : "&nbsp;"}</div>`; }).join("");
    P.box.innerHTML = rows;
  };
  const openPicker = (G) => {
    const i = Number(G.el.dataset.i), it = items[idx];
    if (!it || review || phase === "run") return;
    // диапазон колеса: повторы, минуты или секунды
    const cf = it.reps ? { v: reps[i], min: 0, max: 99, step: 1, px: 30 } : isMinIt(it) ? { v: mins, min: 1, max: 180, step: 1, px: 16 } : it.secs ? { v: secv, min: 5, max: 600, step: 5, px: 22 } : null;
    if (!cf) return;
    const r = G.el.getBoundingClientRect(), box = document.createElement("div");
    box.className = "wk-wheel";
    box.style.cssText = `left:${Math.round(r.left + r.width / 2 - 52)}px;bottom:${Math.round(window.innerHeight - r.top + 10)}px`;
    G.picker = { i, base: cf.v, sel: cf.v, box, min: cf.min, max: cf.max, step: cf.step, px: cf.px };
    wheel(G);
    ov.appendChild(box);
    try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* ignore */ }
  };
  ov.addEventListener("pointerdown", (e) => {
    sndUnlock();
    const el = e.target.closest("[data-g]");
    if (!el) { g = null; return; }
    g = { k: el.dataset.g, el, x: e.clientX, y: e.clientY, pid: e.pointerId, lp: 0, picker: null, moved: false };
    if (g.k === "pl") { const G = g; G.lp = setTimeout(() => { if (g === G && !G.moved) openPicker(G); }, 420); }
  });
  ov.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.picker) {
      const P = g.picker, v = Math.max(P.min, Math.min(P.max, P.base + Math.round(-dy / P.px) * P.step));
      if (v !== P.sel) { P.sel = v; wheel(g); }
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { g.moved = true; clearTimeout(g.lp); }
  });
  const endG = (e, cancel) => {
    if (!g || e.pointerId !== g.pid) return;
    const G = g; g = null; clearTimeout(G.lp);
    const dx = e.clientX - G.x, dy = e.clientY - G.y, tap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
    if (G.picker) { G.picker.box.remove(); if (!cancel) pick(G.picker.i, G.picker.sel); return; }
    if (cancel) return;
    const it = items[idx];
    if (!it) return;
    if (G.k === "pl" && tap) {
      if (it.reps) { if (phase === "work" && !review && Number(G.el.dataset.i) === setNo) setDone(); }
      else if (phase === "work" && !review) { if (isMinIt(it)) recMin(it, mins); else { markDone(it); next(); } }
    } else if (G.k === "rest") {
      if (phase === "run") { if (dx < -50 && Math.abs(dy) < 60) finishRun(true); else if (tap) rest15(isMinIt(it) ? 60 : 15); }
      else if (phase === "work") { if (tap) startRun(); }
      else if (dx < -50 && Math.abs(dy) < 60) restSkip(); else if (tap) rest15();
    }
    else if (G.k === "hint") { if (tap || dy < -25) openTrainExercise(date, it.key); }
  };
  ov.addEventListener("pointerup", (e) => endG(e, false));
  ov.addEventListener("pointercancel", (e) => endG(e, true));
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]");
    if (!b) return;
    const w = b.dataset.w, it = items[idx];
    if (w === "finish") { ov.close(); openTrainFinish(date); return; }
    if (w === "ret") { const k = Number(b.dataset.k); skipped.delete(items[k].key); idx = k; retMode = true; enterItem(); draw(); return; }
    if (!it) return;
    if (w === "redo") { review = false; setNo = 0; reps = it.reps ? Array.from({ length: it.sets }, () => it.reps[1]) : []; if (it.reps) saveTrainLog(date, { sets: { [it.id]: [] } }); draw(); return; }
    if (w === "skip") {
      const was = idx, wasDone = isDone(it);
      if (!wasDone) skipped.add(it.key);
      next();
      if (!wasDone) toast(`Пропущено: ${it.name}`, () => { skipped.delete(it.key); idx = was; enterItem(); draw(); });
      return;
    }
    if (w === "prev") { if (idx > 0) { idx--; enterItem(); draw(); } return; }
    if (w === "info") openTrainExercise(date, it.key);
  });
  enterItem();
  draw();
}

// Добавление своего упражнения в день: выбираете упражнение, группу и объём, дальше оно идёт как обычное
function openTrainAdd(date) {
  const f = { cat: "all", id: "", group: "", sets: 3, reps: 12, secs: 40, minutes: 10 };
  const cats = [["all", "Все"], ["main", "Силовые"], ["cardio", "Кардио"], ["cool", "Растяжка"]];
  const groups = [["warm", "Разминка"], ["main", "Основная часть"], ["cardio", "Кардио"], ["cool", "Растяжка"]];
  const ov = openSheet(`<div class="sheet-head"><h2>Добавить упражнение</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div><div id="ta-body"></div>`);
  const body = $("#ta-body", ov);
  const draw = () => {
    if (!f.id) {
      const list = Object.values(TR.EXERCISES).filter((e) => f.cat === "all" || TR.GROUP_OF(e) === f.cat);
      body.innerHTML = `<p class="foot-note" style="margin:-4px 2px 10px">${esc(trainDayName(date))}. Выберите упражнение, а категорию и объём зададите дальше.</p>
        <div class="chips" style="margin:0 0 10px">${cats.map(([v, t]) => `<button type="button" class="chip${f.cat === v ? " sel" : ""}" data-ta-cat="${v}">${t}</button>`).join("")}</div>
        <div class="ta-list">${list.map((e) => `<button type="button" class="ta-row" data-ta-id="${esc(e.id)}"><b>${esc(e.name)}</b><small>${esc(e.muscles)}</small></button>`).join("")}</div>`;
      return;
    }
    const ex = TR.EXERCISES[f.id], cardio = ex.kind === "cardio", stretch = ex.kind === "stretch", timed = !cardio && !stretch && !ex.reps;
    const fld = (id, label, v, hint) => `<label class="field"><span>${label}</span><input class="input" id="${id}" inputmode="numeric" value="${v}">${hint ? `<small class="foot-note" style="margin:2px 4px 0">${hint}</small>` : ""}</label>`;
    body.innerHTML = `<h3 class="ex-h" style="margin-top:0">${esc(ex.name)}</h3><p class="foot-note" style="margin:-6px 2px 12px">${esc(ex.muscles)}</p>
      <div class="field"><span>Категория</span><div class="chips" style="margin:0">${groups.map(([v, t]) => `<button type="button" class="chip${f.group === v ? " sel" : ""}" data-ta-grp="${v}">${t}</button>`).join("")}</div></div>
      ${cardio ? fld("ta-min", "Сколько минут", f.minutes, "Время можно будет изменить прямо во время тренировки") : stretch ? fld("ta-secs", `Секунд${ex.side ? " на сторону" : ""}`, f.secs) : `${fld("ta-sets", "Подходов", f.sets)}${timed ? fld("ta-secs", `Секунд в подходе${ex.side ? " на сторону" : ""}`, f.secs) : fld("ta-reps", `Повторений в подходе${ex.side ? " на сторону" : ""}`, f.reps)}`}
      <div class="row"><button type="button" class="btn ghost" data-ta-back>Назад</button><button type="button" class="btn primary grow" data-ta-add>Добавить в тренировку</button></div>`;
  };
  const read = () => {
    const g = (id) => { const e = $(id, ov); return e ? Number(String(e.value).replace(",", ".")) || 0 : 0; };
    if ($("#ta-min", ov)) f.minutes = g("#ta-min"); if ($("#ta-secs", ov)) f.secs = g("#ta-secs"); if ($("#ta-sets", ov)) f.sets = g("#ta-sets"); if ($("#ta-reps", ov)) f.reps = g("#ta-reps");
  };
  ov.addEventListener("click", (e) => {
    const c = e.target.closest("[data-ta-cat]"), r = e.target.closest("[data-ta-id]"), g = e.target.closest("[data-ta-grp]");
    if (c) { f.cat = c.dataset.taCat; draw(); return; }
    if (r) { f.id = r.dataset.taId; const ex = TR.EXERCISES[f.id]; f.group = TR.GROUP_OF(ex); f.reps = ex.reps ? Math.round((ex.reps[0] + ex.reps[1]) / 2) : 12; f.secs = ex.secs ? ex.secs[1] : 40; f.minutes = f.group === "warm" ? 5 : 10; draw(); return; }
    if (g) { read(); f.group = g.dataset.taGrp; draw(); return; }
    if (e.target.closest("[data-ta-back]")) { read(); f.id = ""; draw(); return; }
    if (e.target.closest("[data-ta-add]")) {
      read();
      const old = ((trainLogOn(date) || {}).custom) || [];
      const n = old.reduce((m, x) => Math.max(m, Number(x.n) || 0), 0) + 1;
      const spec = { n, id: f.id, group: f.group, sets: f.sets, reps: f.reps, secs: f.secs, minutes: f.minutes };
      saveTrainLog(date, { custom: [...old, spec] });
      state.trainDayOpen = true;
      state.date = date;
      ov.close(); render();
    }
  });
  draw();
}

// Окно упражнения: рисунок «старт и финиш», как выполнять, типичные ошибки
function openTrainExercise(date, key) {
  const ses = trainSession(date);
  const it = ses && ses.items.find((i) => i.key === key);
  if (!it) return;
  const ex = TR.EXERCISES[it.id];
  const cfg = trainCfg();
  const isDone = () => !!((trainLogOn(date) || {}).done || {})[key];
  const res = it.vk === "band" || it.vk === "bandf" || it.vk === "cable"
    ? `<p class="ex-note">Подберите сопротивление так, чтобы последние 2–3 повторения давались тяжело, но техника не ломалась. Когда верхняя граница диапазона даётся легко, возьмите резинку потяжелее или добавьте паузу внизу.</p>`
    : it.vk === "db" ? `<p class="ex-note">Вес гантелей подбирайте так же: последние 2–3 повторения тяжёлые, но техника чистая.${cfg.dumbbellKg ? ` Ваши гантели: ${fmt(cfg.dumbbellKg)} кг. Если легко, замедлите движение: 3 секунды вниз.` : ""}</p>` : "";
  const exExtraHtml = () => {
    if (isMinIt(it)) { const fm = Number((((trainLogOn(date) || {}).mins) || {})[it.key]) || 0; return `<div class="ex-sets"><span class="ex-vars-t">Сколько прошли, мин · время выбираете сами</span><input class="input" id="ex-mins" inputmode="numeric" placeholder="${it.minutes}" value="${fm || ""}"></div>`; }
    if (!it.reps && it.group !== "main") return "";
    const lg = trainLogOn(date) || {};
    const cur = setsOn(date, it.id);
    const hist = exHist(it.id, date);
    const prev = hist.filter((h) => h.date < date).slice(-1)[0];
    const hi = it.reps ? it.reps[1] : 0;
    let h = "";
    if (it.reps) {
      h += `<div class="ex-sets"><span class="ex-vars-t">Повторы по подходам${prev ? ` · в прошлый раз ${prev.sets.join("/")}` : ""}</span><div class="ex-setrow">${Array.from({ length: it.sets }, (_, i) => `<label class="ex-sl"><small>${i + 1}</small><input class="input ex-set" inputmode="numeric" data-set="${i}" placeholder="${hi}" value="${cur[i] > 0 ? cur[i] : ""}"></label>`).join("")}</div></div>`;
    }
    if (hist.length) {
      const mx = Math.max(...hist.map((x) => x.total), 1);
      const pr = hist.reduce((b, x) => (x.total > b.total ? x : b), hist[0]);
      h += `<div class="ex-hist"><span class="ex-vars-t">Динамика${hist.length > 1 ? "" : " · первая запись"}</span>${hist.length > 1 ? `<div class="ex-hg">${hist.map((x) => `<div class="ex-hb${x === pr ? " pr" : ""}" title="${esc(dateShort(x.date))}: ${x.total} повторов"><i style="height:${Math.max(8, Math.round((x.total / mx) * 100))}%"></i><small>${(x.date.slice(8) + "." + x.date.slice(5, 7))}</small></div>`).join("")}</div>` : ""}<p class="foot-note" style="margin:4px 2px 0">Рекорд: ${pr.total} повторов за тренировку${pr.band ? ` (${esc(pr.band)}${pr.kg ? `, около ${fmt(pr.kg)} кг` : ""})` : ""}, лучший подход ${Math.max(...hist.map((x) => x.best))}.</p></div>`;
    }
    const lastNote = state.trainLog.filter((l) => l.date < date && l.notes && l.notes[it.id]).sort((p, q) => (p.date < q.date ? 1 : -1))[0];
    const painDays = new Set(state.trainLog.filter((l) => l.date >= addDays(date, -21) && l.pain && l.pain[it.id]).map((l) => l.date));
    h += `<div class="ex-nb"><span class="ex-vars-t">Заметка${lastNote ? ` · в прошлый раз: ${esc(lastNote.notes[it.id])}` : ""}</span><input class="input" id="ex-note" maxlength="120" placeholder="Например: тянет левое плечо" value="${esc((lg.notes || {})[it.id] || "")}"><label class="check" style="margin-top:6px"><input type="checkbox" id="ex-pain" ${(lg.pain || {})[it.id] ? "checked" : ""}>Болит или неприятные ощущения</label>${painDays.size >= 2 ? `<p class="foot-note" style="margin:4px 2px 0">Боль отмечена в ${painDays.size} днях: в будущих планах упражнение заменится другим.</p>` : ""}</div>`;
    return h;
  };
  const savedBand = ((((trainLogOn(date) || {}).ebands) || {})[it.id]) || "";
  const lastB = lastBand(it.id, date);
  let selBand = comboIds(savedBand || lastB);
  const upHint = () => {
    const top = it.reps && topReached(it.id, date, it.reps[1]);
    if (!selBand.length || !(trainAdvice(date).bump > 0 || top)) return "";
    const nx = nextBandCombo(selBand);
    if (!nx) return `<p class="ex-up">Сейчас у вас самое тяжёлое сочетание из имеющихся цветов. Чтобы расти дальше: медленнее опускание (3 сек), пауза 1–2 сек в конце, больше повторов.</p>`;
    const k = comboKey(nx.ids);
    const same = comboKey(selBand) === k;
    return `<div class="ex-up">${top ? `В прошлый раз все подходы были на верхней границе (${it.reps[1]}).` : "В последних тренировках было легко."} Чтобы был прогресс, попробуйте: <b>${esc(bandName(k))}</b> (около ${fmt(nx.kg)} кг)${nx.ids.length > 1 ? ". Сложите трубки вместе и держите обе за ручки" : ""}.${same ? "" : ` <button type="button" class="ex-up-b" data-ebset="${k}">Выбрать</button>`}</div>`;
  };
  const bandsBlock = () => `<span class="ex-vars-t">Какой резинкой${!((((trainLogOn(date) || {}).ebands) || {})[it.id]) && lastB && comboKey(selBand) === comboKey(comboIds(lastB)) ? " · как в прошлый раз, можно сменить" : ""}${selBand.length ? ` · около ${fmt(comboKg(selBand))} кг` : ""}</span><div class="ex-bandrow">${TR.BAND_COLORS.map((c) => `<button type="button" class="ex-bd${selBand.includes(c.id) ? " on" : ""}" data-eb="${c.id}" style="--c:${c.hex}" aria-pressed="${selBand.includes(c.id)}"><i></i>${c.t}</button>`).join("")}</div><span class="ex-vars-t" style="margin-top:6px;font-weight:500">Можно выбрать несколько цветов: трубки складываются.</span>${upHint()}`;
  const ov = openSheet(`
    <div class="sheet-head"><h2>${nameVar(it.name, it.vlabel)}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="ex-fig">${exFig(it.id, it.vk)}</div>
    <div class="ex-meta"><span class="pill">${esc(ex.muscles)}</span></div>
    ${it.vk === "band" || it.vk === "bandf" ? `<div class="ex-vars ex-bands">${bandsBlock()}</div>` : ""}
    ${ex.variants && ex.variants.length > 1 ? `<div class="ex-vars"><span class="ex-vars-t">Как выполнять сейчас</span><div class="chips" style="margin:0">${[["", "Авто"], ...ex.variants.map((v) => [v.k, v.label])].map(([k, t]) => `<button type="button" class="chip${(cfg.vpref[it.id] || "") === k ? " sel" : ""}" data-vk="${esc(k)}">${esc(t)}</button>`).join("")}</div></div>` : ""}
    <p class="ex-do"><b>${esc(trainDetail(it))}</b>${it.cue ? ` ${esc(it.cue)}` : ""}</p>
    ${res}
    <div id="ex-extra">${exExtraHtml()}</div>
    <h3 class="ex-h">Как выполнять</h3>
    <ol class="ex-list">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <h3 class="ex-h">Частые ошибки</h3>
    <ul class="ex-list ex-bad">${ex.mistakes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p class="foot-note" style="margin:14px 2px 12px">Рисунки схематичные: слева начало движения, справа конец. При боли в суставах, головокружении или боли в груди остановитесь.</p>
    ${it.custom ? `<button type="button" class="more-btn red" id="ex-del" style="margin:0 0 10px">Убрать из тренировки</button>` : it.group === "main" ? `<button type="button" class="more-btn" id="ex-swap" style="margin:0 0 10px">Заменить упражнение</button><p class="foot-note" id="ex-swap-msg" style="margin:0 2px 10px"></p>` : ""}
    <button type="button" class="btn primary full" id="tx-done">${isDone() ? "Снять отметку" : "Отметить выполненным"}</button>`);
  $("#tx-done", ov).addEventListener("click", () => {
    if (selBand.length && !isDone() && (((trainLogOn(date) || {}).ebands) || {})[it.id] !== comboKey(selBand)) {
      const cur = { ...(((trainLogOn(date) || {}).ebands) || {}), [it.id]: comboKey(selBand) };
      setDoc(docRef("trainlog", date), { date, ebands: cur, updatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
    }
    actions.trainTick({ date, key }); ov.close();
  });
  ov.addEventListener("change", (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains("ex-set")) {
      const vals = [...ov.querySelectorAll(".ex-set")].map((x) => Math.max(0, Math.min(999, Math.round(Number(String(x.value).replace(",", ".")) || 0))));
      saveTrainLog(date, { sets: { [it.id]: vals } });
    } else if (t.id === "ex-mins") {
      const m = Math.max(0, Math.min(600, Math.round(Number(String(t.value).replace(",", ".")) || 0)));
      saveTrainLog(date, { mins: { [it.key]: m } });
    } else if (t.id === "ex-note") saveTrainLog(date, { notes: { [it.id]: t.value.trim() } });
    else if (t.id === "ex-pain") saveTrainLog(date, { pain: { [it.id]: !!t.checked } });
  });
  const delBtn = $("#ex-del", ov);
  if (delBtn) delBtn.addEventListener("click", () => {
    saveTrainLog(date, { custom: (((trainLogOn(date) || {}).custom) || []).filter((c) => c.n !== it.n), done: { [key]: false } });
    ov.close(); render();
  });
  const swapBtn = $("#ex-swap", ov);
  if (swapBtn) swapBtn.addEventListener("click", () => {
    const s2 = trainSession(date, [it.id]);
    if (s2 && s2.items.some((i) => i.id === it.id && !i.custom)) { $("#ex-swap-msg", ov).textContent = "Подходящей замены для вашего оборудования и ограничений нет."; return; }
    saveTrainLog(date, { swapped: [...new Set([...(((trainLogOn(date) || {}).swapped) || []), it.id])] });
    ov.close(); render();
  });
  ov.addEventListener("click", (e) => {
    const eb = e.target.closest("[data-eb]"), es = e.target.closest("[data-ebset]");
    if (eb || es) {
      if (es) selBand = comboIds(es.dataset.ebset);
      else {
        const id = eb.dataset.eb;
        if (selBand.includes(id)) { if (selBand.length > 1) selBand = selBand.filter((x) => x !== id); } else selBand = [...selBand, id];
      }
      const cur = { ...(((trainLogOn(date) || {}).ebands) || {}), [it.id]: comboKey(selBand) };
      state.trainLog = state.trainLog.map((l) => (l.date === date ? { ...l, ebands: cur } : l));
      setDoc(docRef("trainlog", date), { date, ebands: cur, updatedAt: serverTimestamp() }, { merge: true }).catch(writeFail);
      const box = ov.querySelector(".ex-bands");
      if (box) box.innerHTML = bandsBlock();
      return;
    }
    const b = e.target.closest("[data-vk]");
    if (!b) return;
    const vp = { ...(trainCfg().vpref || {}) };
    if (b.dataset.vk) vp[it.id] = b.dataset.vk; else delete vp[it.id];
    state.trainCfg = { ...(state.trainCfg || {}), vpref: vp };
    setDoc(docRef("settings", "training"), { vpref: vp }, { merge: true }).catch(writeFail);
    ov.close();
    render();
    setTimeout(() => openTrainExercise(date, key), 220);
  });
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
        startedAt: (state.trainCfg && state.trainCfg.startedAt) || todayStr(), moves: mv, vpref: cur.vpref || {}, updatedAt: serverTimestamp(),
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
    state.trainDayOpen = true;
    ov.close();
    render();
  });
}

/* ===== Завершение тренировки, анализ выполненного и прогресс ===== */
const feelLabel = (n) => TR.FEEL[n] || "";
const trainFinished = (d) => { const l = trainLogOn(d); return !!(l && l.finished); };
const finishedLogs = () => state.trainLog.filter((l) => l.finished).sort((a, b) => (a.date < b.date ? 1 : -1));
// Подстройка плана на день d по итогам тренировок ДО этого дня (поэтому день не «прыгает» после завершения):
// - 3 последних оценки: в среднем легко → больше повторов, тяжело → меньше; при двух оценках нужны обе одинаковые;
// - легко, но выполнено меньше 60% плана → нагрузку не повышаем;
// - упражнения, которые пропускают в завершённых тренировках, заменяются другими из той же группы;
// - совет по резинке и гантелям на основе последних итогов.
function trainAdvice(d) {
  const logs = finishedLogs().filter((l) => l.date < d);
  const last = logs.slice(0, 3);
  const fs = last.map((l) => Number(l.feel) || 3);
  const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
  let bump = 0;
  if (last.length >= 3) {
    const avg = mean(fs);
    bump = avg <= 2 ? 2 : avg <= 2.4 ? 1 : avg >= 4 ? -2 : avg >= 3.6 ? -1 : 0;
  } else if (last.length === 2) {
    bump = fs.every((x) => x <= 2) ? 2 : fs.every((x) => x >= 4) ? -2 : 0;
  }
  const comp = (l) => { const p = Array.isArray(l.plan) ? l.plan : []; const dn = l.done || {}; return p.length ? p.filter((k) => dn[k]).length / p.length : 1; };
  let lowDone = false;
  if (bump > 0 && (mean(last.map(comp)) < 0.6 || fs[0] >= 5)) { bump = 0; lowDone = true; }
  // Пропускаемые упражнения за 6 недель: минимум 3 раза в плане и сделано не больше четверти
  const from = addDays(todayStr(), -41), ex = {};
  for (const l of logs) {
    if (l.date < from || !Array.isArray(l.plan)) continue;
    for (const key of l.plan) {
      const [g, id] = key.split(":");
      if (g !== "main") continue;
      const e = ex[id] = ex[id] || { p: 0, d: 0 };
      e.p++; if ((l.done || {})[key]) e.d++;
    }
  }
  const avoid = Object.keys(ex).filter((id) => ex[id].p >= 3 && ex[id].d / ex[id].p <= 0.25);
  // Резинка: самая тяжёлая, что брали в последний раз
  const cfg = trainCfg();
  const eff = (id) => Number(cfg.bandKg[id]) || TR.BAND_DEFAULT_KG[id] || 0;
  const byKg = [...TR.BAND_COLORS].sort((a, b) => eff(a.id) - eff(b.id));
  const bl = logs.find((l) => l.bands && Object.keys(l.bands).length);
  let band = "";
  if (bl) {
    const used = Object.keys(bl.bands).filter((c) => byKg.some((x) => x.id === c));
    const top = used.sort((a, b) => (Number(bl.bands[b]) || eff(b)) - (Number(bl.bands[a]) || eff(a)))[0];
    const topKg = Number(bl.bands[top]) || eff(top);
    const nm = (c) => `${c.t.toLowerCase().replace(/ая$/, "ую").replace(/яя$/, "юю")} (${fmt(eff(c.id))} кг)`, loc = (c) => c.t.toLowerCase().replace(/ая$/, "ой").replace(/яя$/, "ей");
    const topC = TR.BAND_COLORS.find((c) => c.id === top);
    if (topC) {
      const up = byKg.find((c) => eff(c.id) > topKg + 0.2), down = [...byKg].reverse().find((c) => eff(c.id) < topKg - 0.2);
      if (bump > 0) band = up ? `Резинка: в прошлый раз самой тяжёлой была ${topC.t.toLowerCase()}. Попробуйте ${nm(up)} в тех упражнениях, где легко.` : `Вы уже на самой тяжёлой резинке (${topC.t.toLowerCase()}): наращивайте повторы и медленнее опускайте вес.`;
      else if (bump < 0) band = `Резинку не повышайте: оставайтесь на ${loc(topC)}${down ? `, а если совсем тяжело, возьмите ${nm(down)}` : ""}.`;
      else band = `Резинка: оставайтесь на ${loc(topC)}, пока оценки не станут «легко».`;
    }
  }
  const dk = Number(logs.find((l) => l.dumbbellKg)?.dumbbellKg) || 0;
  const bell = dk ? (bump > 0 ? `Гантели: можно прибавить 0,5–1 кг (сейчас ${fmt(dk)} кг).` : bump < 0 ? `Гантели: не прибавляйте вес (сейчас ${fmt(dk)} кг).` : "") : "";
  let tip;
  if (last.length < 2) tip = "Завершайте тренировки кнопкой «Завершить тренировку»: после двух оценок приложение начнёт подбирать нагрузку.";
  else if (lowDone) tip = "Оценки лёгкие, но выполнено меньше 60% плана: нагрузку не повышаем. Сначала доделывайте упражнения до конца.";
  else if (bump > 0) tip = `Последние тренировки были лёгкими. Повторов в следующих планах больше на ${bump}.`;
  else if (bump < 0) tip = `Последние тренировки были тяжёлыми. Повторов в следующих планах меньше на ${-bump}: держите вес и не торопитесь.`;
  else tip = "Нагрузка в самый раз: держите ритм.";
  return { bump, avoid, tip, band, bell, n: last.length };
}
const bandOk = (id) => TR.BAND_COLORS.some((c) => c.id === id);
const comboIds = (s) => String(s || "").split("+").filter(bandOk);
const bandKgOf = (id) => Number(trainCfg().bandKg[id]) || TR.BAND_DEFAULT_KG[id] || 0;
const comboKg = (ids) => ids.reduce((t, id) => t + bandKgOf(id), 0);
const comboKey = (ids) => [...new Set(ids)].sort((p, q) => bandKgOf(q) - bandKgOf(p)).join("+");
const bandName = (s) => comboIds(s).map((id) => (TR.BAND_COLORS.find((c) => c.id === id) || {}).t.toLowerCase()).join(" + ");
// Следующий шаг по нагрузке: самая близкая по силе комбинация резинок, тяжелее текущей (можно сложить две-три трубки вместе)
function nextBandCombo(curIds) {
  const cur = comboKg(curIds), all = TR.BAND_COLORS.map((c) => c.id);
  let best = null;
  for (let m = 1; m < 1 << all.length; m++) {
    const ids = all.filter((_, k) => m & (1 << k));
    if (ids.length > 3) continue;
    const kg = comboKg(ids);
    if (kg > cur + 0.2 && (!best || kg < best.kg - 0.01 || (Math.abs(kg - best.kg) <= 0.01 && ids.length < best.ids.length))) best = { ids, kg };
  }
  return best;
}
// Подпись: «Тяга сидя к поясу: красная; …»
const ebandsText = (l) => Object.entries((l && l.ebands) || {}).filter(([id, c]) => TR.EXERCISES[id] && bandName(c)).map(([id, c]) => `${TR.EXERCISES[id].name}: ${bandName(c)}`).join("; ");
const lastBand = (id, date) => { const l = state.trainLog.filter((x) => x.date < date && x.ebands && x.ebands[id]).sort((p, q) => (p.date < q.date ? 1 : -1))[0]; return l ? l.ebands[id] : ""; };
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
    const cust = (((trainLogOn(d) || {}).custom) || []).length > 0;
    if (!TR.sessionType(cfg, d) && !cust) continue;
    const l = trainLogOn(d), done = (l && l.done) || {};
    const started = l && (l.finished || Object.values(done).some(Boolean));
    if (d === today && !started) continue;
    let keys;
    if (l && Array.isArray(l.plan)) keys = l.plan;
    else { const s = TR.buildSession(state.trainCfg, d, state.profile, trainMinutes(d), 0); keys = s ? s.items.map((i) => i.key) : []; }
    if (cust) keys = [...new Set([...keys, ...customItems(d).map((i) => i.key)])];
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

// Прогресс упражнений: динамика повторов, резинка и рекорды
function exProgressHtml() {
  const ids = new Set();
  state.trainLog.forEach((l) => { if (l.sets) Object.keys(l.sets).forEach((id) => ids.add(id)); });
  const today = todayStr();
  const list = [...ids].filter((id) => TR.EXERCISES[id]).map((id) => ({ id, h: exHist(id, today) })).filter((x) => x.h.length).sort((p, q) => (p.h[p.h.length - 1].date < q.h[q.h.length - 1].date ? 1 : -1));
  if (!list.length) return `<p class="foot-note" style="margin:10px 2px 0">Вносите повторы по подходам в упражнениях или в режиме тренировки: здесь появятся графики и рекорды.</p>`;
  const dd = (d) => `${d.slice(8)}.${d.slice(5, 7)}`;
  const rep = (n) => { const m = Math.abs(n) % 100, l = m % 10; return m > 10 && m < 20 ? "повторов" : l === 1 ? "повтор" : l >= 2 && l <= 4 ? "повтора" : "повторов"; };
  const trend = (v, p) => (v > 0 ? `<i class="xt up">▲ +${v}${p !== null ? ` · ${p >= 0 ? "+" : ""}${p}%` : ""}</i>` : v < 0 ? `<i class="xt down">▼ ${v}${p !== null ? ` · ${p}%` : ""}</i>` : `<i class="xt">без изменений</i>`);
  const exBlock = ({ id, h }) => {
    const last = h[h.length - 1], pr = h.reduce((b, x) => (x.total > b.total ? x : b), h[0]);
    const dl = h.length > 1 ? last.total - h[0].total : 0;
    const bestSet = Math.max(...h.map((x) => x.best));
    return `<div class="xe"><div class="xe-h"><b>${esc(TR.EXERCISES[id].name)}</b>${h.length > 1 ? trend(dl, null) : ""}</div>
      <p class="xe-last"><small>${dd(last.date)}</small>${last.sets.join(" · ")}${last.band ? ` <em>${esc(last.band)}</em>` : ""}${last.kg ? ` <em>≈${fmt(last.kg)} кг</em>` : ""}</p>
      <div class="xs"><div><b>${pr.total}</b><span>рекорд, ${dd(pr.date)}</span></div><div><b>${bestSet}</b><span>лучший подход</span></div><div><b>${h.length}</b><span>${h.length === 1 ? "тренировка" : "тренировок"}</span></div></div></div>`;
  };
  // Группы мышц: свёрнутая карточка с главными цифрами, внутри упражнения
  const groups = {};
  list.forEach((x) => { const g = TR.mgOf(x.id) || "other"; (groups[g] = groups[g] || []).push(x); });
  const wk0 = TR.mondayOf(today), weeks = Array.from({ length: 6 }, (_, k) => addDays(wk0, -7 * (5 - k)));
  const order = [...Object.keys(TR.MG), "other"].filter((g) => groups[g]);
  const openG = state.trainGrpOpen || {};
  return `<div class="xl">` + order.map((g) => {
    const gi = new Set(groups[g].map((x) => x.id));
    const tot = weeks.map((w) => state.trainLog.filter((l) => l.sets && TR.mondayOf(l.date) === w).reduce((s, l) => s + Object.entries(l.sets).filter(([id]) => gi.has(id)).reduce((s2, [, arr]) => s2 + (Array.isArray(arr) ? arr.reduce((p, q) => p + (Number(q) || 0), 0) : 0), 0), 0));
    const nz = tot.map((v, k) => [v, k]).filter(([v]) => v > 0);
    const firstV = nz.length ? nz[0][0] : 0, lastV = nz.length ? nz[nz.length - 1][0] : 0;
    const dl = nz.length > 1 ? lastV - firstV : 0, dp = firstV && nz.length > 1 ? Math.round((dl / firstV) * 100) : null;
    const best = Math.max(...tot), bestK = tot.indexOf(best);
    const open = !!openG[g];
    const nSes = state.trainLog.filter((l) => l.sets && Object.keys(l.sets).some((id) => gi.has(id))).length;
    return `<div class="xg${open ? " open" : ""}" data-mg="${g}"><div class="xg-h" data-act="toggleTrainGrp" data-g="${g}" role="button" aria-expanded="${open}"><div class="xg-t"><b>${esc(TR.MG[g] || "Другое")}</b><small>${groups[g].length} упр.</small></div>${nz.length > 1 ? trend(dl, dp) : ""}${chev(open)}</div>
      <div class="xs"><div><b>${lastV}</b><span>${rep(lastV)} за неделю</span></div><div><b>${best}</b><span>лучшая неделя, с ${dd(weeks[bestK])}</span></div><div><b>${nSes}</b><span>${nSes === 1 ? "тренировка" : "тренировок"}</span></div></div>
      ${open ? `<div class="xg-in">${groups[g].map(exBlock).join("")}</div>` : ""}</div>`;
  }).join("") + `</div>`;
}
function trainProgressCardHtml(day) {
  if (!state.trainCfg) return "";
  const st = trainStats();
  const fin = finishedLogs();
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const feels = fin.slice(0, 5).map((l) => Number(l.feel)).filter(Boolean);
  const avg = feels.length ? feels.reduce((a, b) => a + b, 0) / feels.length : 0;
  const empty = !st.planned && !fin.length && !state.trainLog.some((l) => l.sets);
  const wkKeys = Object.keys(st.weeks).sort().slice(-6);
  const wkBars = wkKeys.map((w) => { const x = st.weeks[w]; return `<div class="tr-bar"><span>${esc(dateShort(w))}</span><div class="track"><i style="width:${pct(x.done, x.plan)}%"></i></div><b>${pct(x.done, x.plan)}%</b></div>`; }).join("");
  const adv = trainAdvice(addDays(todayStr(), 1));
  const tip = [adv.tip, adv.band, adv.bell].filter(Boolean).join(" ");
  const open = state.trainOpen;
  const hist = fin.slice(0, 5).map((l) => `<div class="tr-h"><b>${esc(trainDayName(l.date))}</b><span>${esc(feelLabel(Number(l.feel)))}${bandsText(l) ? ` · ${esc(bandsText(l))}` : ""}${ebandsText(l) ? `<small class="tr-he">${esc(ebandsText(l))}</small>` : ""}</span></div>`).join("");
  return `<section class="card">
    <div class="card-top"><h2 class="h2">Прогресс тренировок</h2></div>
    ${empty ? `<p class="foot-note" style="margin:0 4px">Пока нет данных. Отмечайте упражнения, вносите повторы и завершайте тренировки, и здесь появятся графики и рекорды.</p>` : `
    <div class="stat-grid">
      <div class="stat"><b>${st.plannedDone} из ${st.planned}</b><span>упражнений выполнено${st.planned ? `, ${pct(st.plannedDone, st.planned)}%` : ""}</span></div>
      <div class="stat"><b>${st.daysDone} из ${st.days}</b><span>тренировок завершено</span></div>
      <div class="stat"><b>${st.streak}</b><span>подряд без пропусков</span></div>
      <div class="stat"><b>${avg ? esc(feelLabel(Math.round(avg))) : "—"}</b><span>самочувствие в среднем</span></div>
    </div>
    <p class="tr-tip">${esc(tip)}</p>
    ${trainBalanceInner(day)}
    <div class="card-top tog" data-act="toggleTrain" role="button" aria-expanded="${open}" style="margin-top:14px"><h3 class="ex-h" style="margin:0">Графики упражнений${chev(open)}</h3></div>
    ${open ? `${exProgressHtml()}
    ${wkBars ? `<p class="tr-lab" style="margin-top:14px">Выполнено по неделям</p>${wkBars}` : ""}
    ${hist ? `<h3 class="ex-h">Последние тренировки</h3>${hist}` : ""}` : `<p class="foot-note tr-more">Нажмите, чтобы открыть графики по каждому упражнению</p>`}`}
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
  for (const c of new Set(Object.values(old.ebands || {}).flatMap((s) => comboIds(s)))) if (!(c in f.bands)) f.bands[c] = 0;
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
  if (!confirm("Сбросить весь прогресс тренировок? Отметки, повторы по подходам, цвета резинок, заметки, итоги и оценки будут удалены, а нагрузка начнётся заново с первой недели. Анкета, расписание и выбранные варианты упражнений останутся.")) return;
  try {
    const snap = await getDocs(collection(db, "users", state.user.uid, "trainlog"));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    state.trainLog = [];
    if (state.trainCfg) state.trainCfg = { ...state.trainCfg, startedAt: todayStr() };
    await setDoc(docRef("settings", "training"), { startedAt: todayStr(), updatedAt: serverTimestamp() }, { merge: true });
    render();
  } catch (e) { writeFail(e); }
}

  return { W_CATS, bandsText, ebandsText, feelLabel, openTrainAdd, openTrainExercise, openTrainFinish, openTrainForm, openTrainMove, openTrainWorkout, resetTrainProgress, saveTrainLog, trainBannerHtml, trainCardHtml, trainCfg, trainDynCardHtml, trainLogOn, trainMinutes, trainPlanData, trainProgressCardHtml, trainSession, trainStats, wCat };
}
