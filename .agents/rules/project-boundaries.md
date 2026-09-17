---
trigger: always_on
description: Boundaries between PZ Management project and the original Project Zomboid installation, mandatory knowledge base, and architecture
---

# Project Boundaries, Overview & Knowledge Base

## 0. 🚨 HIGHEST PRIORITY: Разработка модов и папки `*_Port`

- **Рабочая область**: При создании собственных модов или портировании/модификации существующих модов вся разработка, редактирование и создание файлов производятся **ИСКЛЮЧИТЕЛЬНО** в папке, содержащей в имени маркер **`_Port`** (например, `<ModName>_Port`).
- **Неприкосновенность оригиналов**: Папка оригинального мода является **СТРОГО READ-ONLY**. Изменять, удалять или перезаписывать оригинальные файлы запрещено.
- **Workflow**: Анализируем оригинал -> переносим и собираем адаптированную версию только в `*_Port`.

---

## 1. Directory Constraints

- **Active Project Directory**: `E:/PZ Management`
  - Все изменения кода, создание и удаление файлов, запуск сборок и тестирование производятся исключительно в этой папке.

- **Original Game Directory (READ-ONLY)**: `E:/SteamLibrary/steamapps/common/ProjectZomboid`
  - Оригинальная директория игры Project Zomboid используется **исключительно для чтения**.
  - **Категорически запрещено** изменять, создавать, удалять или перезаписывать какие-либо файлы в этой папке.
  - Допускается только чтение/поиск (grep, просмотр исходников Lua, конфигов предметов и ассетов) в качестве референса.

---

## 2. Обязательное требование: База Знаний (`PZ_KNOWLEDGE_BASE.md`)

Любой агент при разработке, валидации или анализе файлов модов и игры **обязан** предварительно ознакомиться с документом:
📖 [**`PZ_KNOWLEDGE_BASE.md`**](file:///E:/PZ%20Management/PZ_KNOWLEDGE_BASE.md).

Документ содержит:
- Полный белый список **217 встроенных событий Lua** (`LuaEventManager`).
- Новый синтаксис Build 42: `craftRecipe`, `entity` (ECS), `fluid`, `item` (неймспейсы `base:`), `PZAPI.ModOptions`.
- Спецификации 34 костей скелета (`Master_Bones.xml`), привязки оружия/рук (`Prop1`, `Prop2`).
- Официальный список 31 тега для Workshop (`WorkshopTags.txt`).
- Контракт работы с оверлеями `ZomboidFileSystem` (`common/`, `42/`, `41/`).

---

## 3. Project Overview & Architecture

**PZ MANAGEMENT** — desktop-приложение (Electron + React 19 + TypeScript, Zero runtime dependencies) для работы с модами Project Zomboid (B41 / B42).

### Модули:
- **Stalker**: Обозреватель и инспектор установленных модов (Steam, Workshop, локальные, серверные).
- **Loadout**: Порядок загрузки клиента (`default.txt`) и серверов (`.ini`), сортировка зависимостей, профили.
- **Workbench**: Создание модов (scaffold), редактирование `mod.info`, валидация (Lua, скрипты, JSON/txt переводы, теги), упаковка в Workshop.
- **Ledger**: Парсинг краш-логов и консоли (`console.txt`), привязка ошибок к модам.
- **Tools**: FBX Forge (конвертер моделей, поддержка `.x` формата PZ) и интеграция с Notepad++.
