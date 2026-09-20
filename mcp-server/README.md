# Project Zomboid Modding MCP Server (`pz-modding-mcp`)

Специализированный **Model Context Protocol (MCP)** сервер для помощи в разработке, анализе, валидации и портировании модов **Project Zomboid (Build 41 и Build 42)**.

---

## 🚀 Предоставляемые инструменты (Tools)

1. **`pz_decompile_class`**
   - Мгновенная декомпиляция любого Java-класса из `projectzomboid.jar` с фильтрацией по сигнатурам методов/полей.
   - Автоматическое кэширование в `.cache/decompile/` для ускорения повторных запросов.

2. **`pz_lookup_event`**
   - Инспекция реестра из 232 канонических событий `LuaEventManager` игры.
   - Поиск по ключевым словам (`Hit`, `Weapon`, `Tick`, `Render`, `Craft` и др.).

3. **`pz_validate_item_script`**
   - Статическая проверка скриптов предметов и оружия на соответствие синтаксису Build 42 (пространства имен `base:`, теги, балансировка скобок, предупреждения об устаревшем синтаксисе B41).

4. **`pz_validate_sandbox_options`**
   - Валидация файлов `sandbox-options.txt`:
     - Обязательная запятая `VERSION = 1,`;
     - Контроль чистого UTF-8 без BOM;
     - Соответствие типов данных (`boolean`, `double`, `integer`, `string`, `enum`).

5. **`pz_sync_port_mod`**
   - Безопасная синхронизация рабочей папки мода (`*_Port`) в `C:\Users\tamer\Zomboid\mods\`.
   - Автоматический аудит перед копированием (проверка отсутствия BOM и кириллицы вне переводов).

6. **`pz_audit_hygiene`**
   - Комплексный аудит гигиены мода:
     - Обнаружение скрытого UTF-8 BOM (`\uFEFF`);
     - Обнаружение кириллических символов вне `Translate/RU/`;
     - Проверка `mod.info` на опасные параметры вроде `versionMax=`.

---

## ⚙️ Конфигурация в Antigravity

Сервер подключен глобально через файл `C:\Users\tamer\.gemini\config\mcp_config.json`:

```json
{
  "mcpServers": {
    "pz-modding": {
      "command": "node",
      "args": ["E:/PZ Management/mcp-server/index.js"],
      "env": {
        "PZ_GAME_JAR": "E:/SteamLibrary/steamapps/common/ProjectZomboid/projectzomboid.jar",
        "PZ_USER_MODS": "C:/Users/tamer/Zomboid/mods"
      }
    }
  }
}
```
