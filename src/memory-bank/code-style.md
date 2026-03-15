# Архитектура и code style React-приложения

## Структура папок

```
src/
├── pages/
│   └── TodoPage/
│       ├── index.tsx              ← только layout + composition, БЕЗ логики
│       ├── components/            ← компоненты только этой страницы
│       │   ├── TodoItem.tsx
│       │   └── TodoForm.tsx
│       ├── hooks/
│       │   └── useTodos.ts        ← вся логика состояния страницы
│       ├── constants.ts           ← FILTER_OPTIONS, DEFAULT_VALUES и т.д.
│       └── utils.ts               ← чистые функции (фильтрация, сортировка)
│
├── ui-kit/                        ← атомарные UI-компоненты БЕЗ бизнес-логики
│   ├── Button/
│   │   ├── index.tsx
│   │   ├── Button.module.css
│   │   └── Button.types.ts        ← ButtonProps, ButtonVariant и т.д.
│   ├── Input/
│   │   ├── index.tsx
│   │   └── Input.module.css
│   ├── Modal/
│   ├── Spinner/
│   └── index.ts                   ← реэкспорт: export * from './Button'
│
├── components/                    ← составные компоненты с бизнес-контекстом
│   └── TodoCard/                  ← использует ui-kit, знает о домене
│       ├── index.tsx
│       └── TodoCard.module.css
│
├── hooks/                         ← глобальные переиспользуемые хуки
│   ├── useLocalStorage.ts
│   └── useDebounce.ts
│
├── types/                         ← глобальные TypeScript типы
│   └── index.ts
│
├── utils/                         ← глобальные чистые функции
│   └── formatDate.ts
│
├── constants/                     ← app-wide константы
│   └── index.ts
│
├── styles/                        ← глобальные стили
│   ├── globals.css
│   ├── variables.css              ← CSS custom properties (цвета, отступы, шрифты)
│   └── reset.css
│
├── assets/                        ← статика: картинки, SVG, шрифты
│   └── icons/
│
├── router/                        ← [ОПЦИОНАЛЬНО] только если несколько страниц
│   ├── index.tsx                  ← createBrowserRouter / Routes
│   └── routes.ts                  ← константы путей: HOME = '/', SETTINGS = '/settings'
│
├── store/                         ← [ОПЦИОНАЛЬНО] только если состояние шарится между страницами
│   ├── index.ts                   ← создание store (Zustand / Redux Toolkit)
│   └── slices/
│       └── todoSlice.ts
│
├── api/                           ← [ОПЦИОНАЛЬНО] только если есть реальный бэкенд
│   ├── client.ts                  ← axios instance / fetch wrapper с baseURL
│   └── todos.ts                   ← getTodos(), createTodo(), deleteTodo()
│
├── App.tsx                        ← только: Router + Provider + глобальные обёртки
└── main.tsx                       ← ReactDOM.render + импорт globals.css
```

## Разница между ui-kit/ и components/

| | `ui-kit/` | `components/` |
|---|---|---|
| Знает о домене | Нет | Да |
| Принимает данные | Только через props (строки, числа) | Может принимать `Todo`, `User` и т.д. |
| Пример | `Button`, `Input`, `Modal`, `Spinner` | `TodoCard`, `UserAvatar` |
| Переиспользование | В любом проекте | Только в этом проекте |

## Правила декомпозиции

- Компонент длиннее 80 строк → разбить на подкомпоненты
- `useState` + `useEffect` + JSX в одном файле → логику вынести в `hooks/useXxx.ts`
- Inline `fetch` / `axios` в компоненте → перенести в `api/`
- Магические строки и числа → в `constants.ts`
- Один файл = одна ответственность

## Правила именования

- Компоненты: `PascalCase` → `TodoItem.tsx`
- Хуки: `camelCase` с префиксом `use` → `useTodos.ts`
- Утилиты и константы: `camelCase` → `formatDate.ts`, `constants.ts`
- CSS-переменные: `--color-primary`, `--spacing-md`
- Папка компонента с вложениями: `Button/index.tsx` (не `Button/Button.tsx`)

## Правила планирования шагов

При генерации плана каждый компонент, хук, утилита — отдельный шаг.
Нельзя создавать один файл, который содержит и UI, и логику, и стили.

Пример правильного плана для страницы:
1. Создать типы → `src/types/index.ts`
2. Создать CSS-переменные → `src/styles/variables.css`
3. Создать ui-kit компонент → `src/ui-kit/Button/index.tsx`
4. Создать утилиты → `src/pages/TodoPage/utils.ts`
5. Создать хук → `src/pages/TodoPage/hooks/useTodos.ts`
6. Создать компонент элемента → `src/pages/TodoPage/components/TodoItem.tsx`
7. Создать компонент формы → `src/pages/TodoPage/components/TodoForm.tsx`
8. Создать страницу → `src/pages/TodoPage/index.tsx` (только composition)
9. Подключить страницу в `App.tsx`