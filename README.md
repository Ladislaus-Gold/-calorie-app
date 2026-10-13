# Калории

Личный дневник питания: вход через Google, продукты с КБЖУ на 100 г, расчёт по граммам, отчёты.
Хранение: Firebase (Authentication + Firestore). Хостинг: GitHub Pages.

## Файлы
- `index.html`, `style.css`, `app.js` — само приложение
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — установка на экран телефона
- `firestore.rules` — правила доступа: каждый видит только свои данные

## Запуск
1. Firebase → Firestore Database → Rules: вставить содержимое `firestore.rules`, нажать Publish.
2. Загрузить все файлы в корень репозитория GitHub (без вложенных папок).
3. Settings → Pages → Deploy from a branch → main / root.
4. Firebase → Authentication → Settings → Authorized domains → добавить `ВАШ-ЛОГИН.github.io`.
5. Открыть адрес сайта в Safari на iPhone → «Поделиться» → «На экран “Домой”».

## Где что лежит в базе
- `users/{uid}/products` — ваши продукты (значения на 100 г)
- `users/{uid}/entries` — записи дневника (дата, приём пищи, граммы, посчитанные КБЖУ)
- `users/{uid}/settings/profile` — дневная цель по калориям
