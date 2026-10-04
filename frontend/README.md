# MenuMind frontend

React 19, TypeScript, Vite. Шрифты поставляются локально. Студия использует API и серверную авторизацию; localStorage не используется для данных аккаунта.

Запускайте проект из корня репозитория:

```sh
npm ci
npm run dev
```

Сайт: http://127.0.0.1:5173. Vite перенаправляет `/api` на http://127.0.0.1:3001. Адрес прокси можно изменить через `API_PROXY_TARGET`.

Основные файлы: `src/Root.tsx` — лендинг и авторизация, `src/App.tsx` — студия, `src/api.ts` — HTTP-клиент, `src/components/Account.tsx` — профиль и история, `src/components/ApiDocs.tsx` — документация.

Полная инструкция, конфигурация LLM и проверки описаны в [корневом README](../README.md).
