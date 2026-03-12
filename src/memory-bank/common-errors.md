# Типичные ошибки и как их исправлять

## Cannot find module './Component'
- Причина: файл не создан или неправильный путь
- Решение: проверить list_files(), создать недостающий файл

## Module '"react"' has no exported member 'X'
- Причина: неправильный импорт (именованный вместо default или наоборот)
- Решение: `import React from "react"` для default, `import { useState } from "react"` для named

## JSX element type 'X' does not have any construct or call signatures
- Причина: компонент экспортирован неправильно
- Решение: убедиться что компонент экспортирован как `export default function Component()`

## npm ERR! Could not resolve dependency
- Причина: конфликт версий пакетов
- Решение: использовать `npm install --legacy-peer-deps`

## vite: command not found
- Причина: vite не установлен или не в devDependencies
- Решение: убедиться что vite в devDependencies, запустить npm install

## Property 'X' does not exist on type 'Y'
- Причина: TypeScript не знает о свойстве
- Решение: добавить интерфейс или тип для пропсов компонента

## DO NOT:
- Не использовать require() — только import
- Не забывать .tsx расширение для файлов с JSX
- Не создавать index.html внутри src/ — он должен быть в корне
- Не забывать type="module" в package.json
