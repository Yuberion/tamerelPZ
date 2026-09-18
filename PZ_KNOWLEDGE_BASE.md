# PROJECT ZOMBOID & PZ MANAGEMENT KNOWLEDGE BASE
*(Официальная техническая база знаний движка игры и архитектуры проекта)*

> **СТАТУС И ВАЖНОСТЬ**: Данный документ является **каноническим источником знаний (Single Source of Truth)** о внутреннем устройстве Project Zomboid (Build 41 и Build 42) и архитектурных контрактах приложения **PZ Management**.
> **ОБЯЗАТЕЛЬНО К ПРОЧТЕНИЮ**: Любой агент или разработчик обязан изучить данный документ перед внесением изменений в валидаторы, парсеры, скаффолдинг, конвертеры или логику работы с файлами модов и игры.

---

## 1. Архитектура движка Project Zomboid

- **Среда исполнения**: Java 17+ (64-bit JVM, сборщики мусора ZGC/G1GC). Файл конфигурации запуска: `ProjectZomboid64.json`.
- **Скриптовый движок**: Модифицированный **Kahlua** (интерпретатор Lua 5.1 на Java).
  - Среда изолирована: стандартные модули `io.*`, `os.*` отключены из соображений безопасности.
  - Взаимодействие с Java: методы и классы движка пробрасываются в Lua через JNI/рефлексию.
  - Аннотации ядра: `@UsedFromLua` (разрешенные к вызову) и `@HiddenFromLua` (скрытые).
  - Коллекции Java: методы Java часто возвращают объекты `ArrayList` или `HashMap`. В Lua они **не индексируются через `ipairs` или `#`**. Итерация производится методами `:size()` и `:get(i)` (индексация 0-based!). Таблицы Lua традиционно 1-based.
- **Подсистемы движка**:
  - Графика и 3D: OpenGL / DirectX, собственные шейдеры (`media/shaders/`), скелетная анимация.
  - Аудио: FMOD Studio (`fmodstudio.dll`, банки звуков в `media/sound/`).
  - Физика и коллизии: PZBullet (`PZBullet64.dll`), система рэгдоллов (`ragdolls/`).
  - Многопользовательский режим: RakNet (`RakNet64.dll`), ZNet (`ZNetJNI64.dll`).

---

## 2. Файловая система и загрузка модов (`ZomboidFileSystem`)

### 2.1. Иерархия директорий версий (Build 41 vs Build 42)
Движок (`zombie.ZomboidFileSystem`) реализует многоуровневый оверлей файлов:
1. **Build 41 Layout**:
   - `MyMod/mod.info` в корне мода.
   - `MyMod/media/` в корне мода (`lua/`, `scripts/`, `textures/`).
2. **Build 42 Layout**:
   - `MyMod/common/` — общие ресурсы (крупные ассеты, модели, текстуры, кросс-версионный `mod.info`).
   - `MyMod/42/` (или `42.x/`) — переопределения исключительно для сборки Build 42.
   - `MyMod/41/` — переопределения исключительно для сборки Build 41.
   - *Важно*: B42 **игнорирует корневой `mod.info`**, если мод оформлен с подпапками версий. Порядок приоритета в движке: версия с наибольшим номером > `common` > корень.

### 2.2. Контракт `mod.info`
- Парсер движка: `zombie.gameStates.ChooseGameInfo$Mod`.
- Значения по умолчанию при отсутствии полей: `name = "Unnamed Mod"`, `id = "undefined_id"`.
- Формат: `key=value`, регистр ключей нечувствителен. Комментарии: `#`, `//`, `;`.
- **Список ключей**:
  - `id`: уникальный идентификатор мода. В B42 поддерживается форма `id=<workshopId>/<modId>`.
  - `name`: отображаемое имя.
  - `description`: описание (поддерживается многострочность и повторение ключа `description=` для разных абзацев/языков).
  - `poster` / `icon`: относительные пути к изображениям.
  - `require=` / `requires=`: жесткие зависимости мода через запятую или точку с запятой.
  - `pack=`: подключение texture pack (`.pack` из `media/texturepacks/`).
  - `tiledef=`: регистрация номера и файла тайлов (`.tiledef`).
  - `pzversion=` / `versionmin=`: поддерживаемая версия игры.
  - `modversion=` / `version=`: версия мода.
  - `tags=` / `category=`: метки категорий (должны соответствовать официальным).

### 2.3. Порядок загрузки (`ActiveMods` & `ActiveModsFile`)
Формат файла `default.txt` (клиент) и сохранения:
```txt
VERSION = 1
mods
{
    modId1,
    modId2,
}
maps
{
    MapFolder1,
    MapFolder2,
}
```
Для выделенных серверов (`Zomboid/Server/<name>.ini`):
- `Mods=modId1;modId2;...`
- `WorkshopItems=12345678;87654321;...`

---

## 3. Скриптовая грамматика Build 42 (`media/scripts/`)

В Build 42 скрипты разделены по подпапкам в `media/scripts/generated/` и получили строгие пространства имен (`base:`).

### 3.1. Предметы (`item`)
```txt
module Base
{
    item Hat_SantaHatDebug
    {
        DisplayCategory = Accessory,
        ItemType = base:normal,          /* Важно: в B42 base:normal вместо Type = Normal */
        Weight = 0.5,
        Icon = HatSantaRed,
        BloodLocation = Head,
        BodyLocation = base:hat,         /* Неймспейс base: */
        CanHaveHoles = false,
        ChanceToFall = 80,
        Insulation = 0.8,
        WindResistance = 0.25,
        StaticModel = SantaHat_Debug,
        WorldStaticModel = SantaHat_Debug,
        Tags = base:isfirefuel;base:isfiretinder,
    }
}
```

### 3.2. Рецепты крафта нового поколения (`craftRecipe`)
Вместо устаревшего блока `recipe` в B42 используется `craftRecipe` с отдельными блоками `inputs` и `outputs`:
```txt
module Base
{
    craftRecipe MakeStoneAwl
    {
        time = 230,
        NeedToBeLearn = true,
        Tags = AnySurfaceCraft,
        category = Knapping,
        timedAction = Chisel_Surface,
        xpAward = FlintKnapping:10,
        AutoLearnAny = FlintKnapping:2,
        OnCreate = RecipeCodeOnCreate.minorCondition,
        inputs
        {
            item 1 [Base.SharpedStone] flags[Prop2],
            item 1 tags[base:hammerstone;base:mallet;base:knappingtool] mode:keep flags[MayDegradeLight;Prop1],
        }
        outputs
        {
            item 1 Base.Awl_Stone,
        }
    }
}
```
- **Флаги ингредиентов**: `Prop1`, `Prop2` (привязка к костям рук), `mode:keep` (инструмент не расходуется), `MayDegradeLight`, `InheritCondition`, `IsHeadPart`, `DontReplace`, `DontRecordInput`.

### 3.3. Сущности и компоненты ECS (`entity`)
Все станки, верстаки, печи, источники энергии и загоны описываются через компоненты:
```txt
module Base
{
    entity Forge_Primitive_Forge
    {
        component UiConfig
        {
            xuiSkin = default,
            entityStyle = ES_Forge_I,
            uiEnabled = true,
        }
        component CraftBench
        {
            Recipes = PrimitiveForge,
        }
        component SpriteConfig
        {
            health = 150,
            skillBaseHealth = 50,
            face S { layer { row = crafted_01_61 crafted_01_20, } }
            face E { layer { row = crafted_01_21, row = crafted_01_62, } }
        }
        component CraftRecipe
        {
            timedAction = Make_With_Brick_Low,
            time = 50,
            category = Blacksmithing,
            Tooltip = Tooltip_craft_forgeIDesc,
            inputs
            {
                item 1 tags[base:concrete] flags[DontRecordInput],
                item 10 [Base.Stone2],
                item 1 [Base.StoneAnvil],
            }
        }
    }
}
```

### 3.4. Жидкости (`fluid`)
```txt
module Base
{
    fluid TaintedWater
    {
        ColorReference = LightSkyBlue,
        DisplayName = Fluid_Name_TaintedWater,
        Categories { Beverage, Hazardous, Water, }
        Properties { ThirstChange = -50.0, }
        Poison
        {
            maxEffect = Medium,
            minAmount = 1.0,
            diluteRatio = 0.2,
        }
    }
}
```

### 3.5. Декларативный UI (XUI)
Файлы в `media/scripts/xui/` задают темы и стили окон:
```txt
module Base
{
    xuiSkin default
    {
        entity ES_Forge_I
        {
            LuaWindowClass = ISEntityWindow,
            DisplayName = Primitive Forge,
            Icon = Item_Anvil_Stone,
        }
    }
}
```

---

## 4. Lua Архитектура и API

### 4.1. ООП Модель (`ISBaseObject.lua`)
- Создание подкласса: `local MyClass = ISBaseObject:derive("MyClass")`
- Конструктор: `function MyClass:new(...) local o = ISBaseObject.new(self); ... return o end`
- Проверка типа: `ISBaseObject:instanceof(obj, "MyClass")`
- События объекта: `obj:addEventListener("event", callback, target)`, `obj:triggerEvent("event", ...)`.

### 4.2. Нативная библиотека опций (`PZAPI.ModOptions`)
В B42 встроен интерфейс для создания пользовательских меню настроек модов (`media/lua/client/PZAPI/ModOptions.lua`):
```lua
local options = PZAPI.ModOptions:create("MyModID", "My Mod Name")
options:addTickBox("enableFeature", "Включить функцию", true, "Подсказка")
options:addSlider("multiplier", "Множитель", 1, 10, 1, 5, "Описание")
options:addCombobox("mode", "Режим", {"Легкий", "Сложный"}, 1, "Выбор")
options:addColorPicker("color", "Цвет", 1.0, 0.5, 0.2, 1.0, "Цветовая схема")
```

---

## 5. Полный канонический реестр событий Lua (217 Events)

Извлечен напрямую из байткода `zombie.Lua.LuaEventManager.class`. Валидатор Workbench должен использовать его как белый список для `Events.<Name>.Add()`:

```text
OnAcceptInvite, OnAddBuilding, OnAddMessage, OnAdminMessage, OnAIStateChange, OnAIStateEnter, OnAIStateExecute, OnAIStateExit, OnAlertMessage, OnAmbientSound, OnAnimalTracks, OnBeingHitByZombie, OnCGlobalObjectSystemInit, OnChallengeQuery, OnChangeWeather, OnCharacterCollide, OnCharacterCreateStats, OnCharacterDeath, OnCharacterMeet, OnChatWindowInit, OnClickedAnimalForContext, OnClientCommand, OnClimateManagerInit, OnClimateTick, OnClimateTickDebug, OnClothingUpdated, OnConnected, OnConnectFailed, OnConnectionStateChanged, OnContainerUpdate, OnContextKey, OnCoopJoinFailed, OnCoopServerMessage, OnCreateLivingCharacter, OnCreatePlayer, OnCreateSurvivor, OnCreateUI, OnCustomUIKey, OnCustomUIKeyPressed, OnCustomUIKeyReleased, OnDawn, OnDeadBodySpawn, OnDestroyIsoThumpable, OnDeviceText, OnDisconnect, OnDistributionMerge, OnDoTileBuilding, OnDoTileBuilding2, OnDoTileBuilding3, OnDusk, OnDynamicMovableRecipe, OneMinute, OnEnterVehicle, OnEquipPrimary, OnEquipSecondary, OnFETick, OnFillContainer, OnFillInventoryObjectContextMenu, OnFillWorldObjectContextMenu, OnFishingActionMPUpdate, OnGameBoot, OnGamepadConnect, OnGamepadDisconnect, OnGameStart, OnGameStateEnter, OnGameTimeLoaded, OnGoogleAuthRequest, OnGridBurnt, OnHitZombie, OnInitGlobalModData, OnInitModdedWeatherStage, OnInitRecordedMedia, OnInitSeasons, OnInitWorld, OnIsoThumpableLoad, OnIsoThumpableSave, OnItemFound, OnJoypadActivate, OnJoypadActivateUI, OnJoypadBeforeDeactivate, OnJoypadBeforeReactivate, OnJoypadDeactivate, OnJoypadDebugRenderUIOptionSet, OnJoypadReactivate, OnJoypadRenderUI, OnKeyKeepPressed, OnKeyPressed, OnKeyStartPressed, OnLoad, OnLoadedMapZones, OnLoadedTileDefinitions, OnLoadMapZones, OnLoadRadioScripts, OnLoadSoundBanks, OnLoginState, OnLoginStateSuccess, OnMainMenuEnter, OnMakeItem, OnMapLoadCreateIsoObject, OnMechanicActionDone, OnMiniScoreboardUpdate, OnModsModified, OnMouseDown, OnMouseMove, OnMouseUp, OnMouseWheel, OnMovingObjectCrop, OnMultiTriggerNPCEvent, OnNetworkUsersReceived, OnNewFire, OnNewGame, OnNewSurvivorGroup, OnNPCSurvivorUpdate, OnObjectAboutToBeRemoved, OnObjectAdded, OnObjectCollide, OnObjectLeftMouseButtonDown, OnObjectLeftMouseButtonUp, OnObjectRightMouseButtonDown, OnObjectRightMouseButtonUp, OnOverrideSearchManager, OnPlayerAttackFinished, OnPlayerDeath, OnPlayerGetDamage, OnPlayerMove, OnPlayerSetSafehouse, OnPlayerUpdate, OnPostCharactersSquareDraw, OnPostDistributionMerge, OnPostFloorLayerDraw, OnPostFloorSquareDraw, OnPostMapLoad, OnPostRender, OnPostSave, OnPostTileDraw, OnPostTilesSquareDraw, OnPostUIDraw, OnPostWallSquareDraw, OnPreDistributionMerge, OnPreFillInventoryObjectContextMenu, OnPreFillWorldObjectContextMenu, OnPreGameStart, OnPreMapLoad, OnPressRackButton, OnPressReloadButton, OnPressWalkTo, OnPreUIDraw, OnProcessAction, OnProcessTransaction, OnQRReceived, OnRadioInteraction, OnRainStart, OnRainStop, OnReceiveGlobalModData, OnReceiveItemListNet, OnReceiveUserlog, OnRefreshInventoryWindowContainers, OnRenderTick, OnRenderUpdate, OnResetLua, OnResolutionChange, OnRightMouseDown, OnRightMouseUp, OnRolesReceived, OnSafehousesChanged, OnSave, OnScoreboardUpdate, OnSeeNewRoom, OnServerCommand, OnServerCustomizationDataReceived, OnServerFinishSaving, OnServerStarted, OnServerStartSaving, OnServerStatisticReceived, OnServerWorkshopItems, OnSetDefaultTab, OnSGlobalObjectSystemInit, OnSleepingTick, OnSourceWindowFileReload, OnSpawnRegionsLoaded, OnSpawnVehicleEnd, OnSpawnVehicleStart, OnSteamGameJoin, OnSteamRefreshInternetServers, OnSteamRulesRefreshComplete, OnSteamServerFailedToRespond2, OnSteamServerResponded, OnSteamServerResponded2, OnTabAdded, OnTabRemoved, OnTemplateTextInit, OnThrowableExplode, OnThunderEvent, OnTick, OnTickCallbacks, OnTickEvenPaused, OnTileRemoved, OnTriggerNPCEvent, OnUpdateModdedWeatherStage, OnVehicleDamageTexture, OnWarUpdate, OnWaterAmountChange, OnWeaponHitCharacter, OnWeaponHitThumpable, OnWeaponHitTree, OnWeaponHitXp, OnWeaponSwing, OnWeaponSwingHitPoint, OnWeatherPeriodComplete, OnWeatherPeriodStage, OnWeatherPeriodStart, OnWeatherPeriodStop, OnWorldMessage, OnWorldSound, OnZombieCreate, OnZombieDead, OnZombieUpdate
```

---

## 6. 3D Модели, Анимации и Скелеты

### 6.1. Скелет гуманоида (`Master_Bones.xml`)
34 канонические кости, к которым привязываются меши и предметы персонажа:
1. `Dummy01` (Root)
2. `Bip01`
3. `Bip01_Pelvis`
4. `Bip01_Spine`, `Bip01_Spine1`
5. `Bip01_Neck`, `Bip01_Head`
6. Руки: `Bip01_L_Clavicle`, `Bip01_L_UpperArm`, `Bip01_L_Forearm`, `Bip01_L_Hand`, `Bip01_L_Finger0`, `Bip01_L_Finger1` (и симметричные `R_`)
7. Ноги: `Bip01_L_Thigh`, `Bip01_L_Calf`, `Bip01_L_Foot`, `Bip01_L_Toe0` (и симметричные `R_`)
8. Одежда/Экипировка: `Bip01_BackPack`, `Bip01_DressFront`, `Bip01_DressBack`
9. Точки крепления предметов в руках: `Bip01_Prop1` (основное оружие/предмет в правой руке), `Bip01_Prop2` (второстепенный предмет/левая рука)
10. `Translation_Data`

### 6.2. Модели и ассеты одежды (`media/clothing/clothingItems/*.xml` & GUID)
Все элементы одежды регистрируются в глобальной таблице `media/fileGuidTable.xml` через UUID.
Формат `clothingItem`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<clothingItem>
    <m_MaleModel>skinned\clothes\bob_apron</m_MaleModel>
    <m_FemaleModel>skinned\clothes\kate_apron</m_FemaleModel>
    <m_GUID>16960734-6e29-4235-92f9-40bd68cc4520</m_GUID>
    <m_Static>false</m_Static>
    <m_AllowRandomHue>false</m_AllowRandomHue>
    <m_AllowRandomTint>false</m_AllowRandomTint>
    <m_AttachBone></m_AttachBone>
    <textureChoices>clothes\apron\apron_black</textureChoices>
</clothingItem>
```

### 6.3. Конвертер FBX Forge в PZ Management
- Поддерживает парсинг DirectX `.x` файлов (текстовые и бинарные токенные потоки).
- Левостороннее зеркалирование по Z и перемотка полигонов для устранения инверсии нормалей при переносе в FBX.
- Сшивка вершин STL по сетке `1e-5`.
- Запекание иерархических трансформаций узлов `Frame` в вершины.

---

## 7. Официальные теги Steam Workshop (`WorkshopTags.txt`)

31 официальный тег, допустимый для публикации модов в Workshop:
- `Build 40`, `Build 41`, `Build 42`
- `Animals`, `Audio`, `Balance`, `Building`, `Clothing/Armor`, `Farming`, `Food`, `Framework`, `Hardmode`, `Interface`, `Items`, `Language/Translation`, `Literature`, `Map`, `Military`, `Misc`, `Models`, `Multiplayer`, `Pop Culture`, `Realistic`, `Silly/Fun`, `Skills`, `Textures`, `Traits`, `Vehicles`, `QoL`, `WIP`, `Weapons`

---

## 8. Архитектурное руководство для модулей PZ Management

1. **Stalker (Explorer)**:
   - При сканировании модов классифицировать не только B41 папки, но и B42 сущности (`media/scripts/generated/entities/`, `fluids/`, `craftRecipes/`).
2. **Loadout**:
   - Чтение и запись файлов порядка загрузки производить только через валидацию `ActiveModsFile` (`VERSION = 1`, блоки `mods` и `maps`).
   - Для серверов сохранять целостность комментариев и других параметров `.ini`.
3. **Workbench**:
   - Валидатор обязан сверять подписки Lua с 217 событиями из раздела 5.
   - Валидатор `workshop.txt` должен сверять теги со списком из раздела 7.
   - Генератор шаблонов скаффолдинга должен предоставлять опцию создания B42 `craftRecipe` и шаблонов интеграции с `PZAPI.ModOptions`.
4. **Ledger**:
   - Учитывать, что в B42 многие Lua-ошибки выводятся с префиксом `LOG:`, а не `ERROR:`, требуя эвристики по содержимому строки (стектрейс, nil access).
5. **Tools (FBX Forge)**:
   - Использовать карту костей гуманоида из `Master_Bones.xml` для правильного маппинга скелетов и точек крепления `Prop1` / `Prop2`.
6. **Моддинг и портирование (Правило наивысшего приоритета `*_Port`)**:
   - При написании новых модов или модификации/переделке/портировании существующих, вся работа, файлы и код создаются **ИСКЛЮЧИТЕЛЬНО** в папке с маркером `_Port` в имени (`<ModName>_Port`).
   - Оригинальная папка мода всегда имеет статус **READ-ONLY** и никогда не модифицируется.


---

## 9. Канонический пайплайн портирования модов с Build 41 на Build 42 (The Definitive B41 -> B42 Porting Pipeline)

> [!IMPORTANT]
> Данный раздел документирует проверенный и валидированный на практике метод полной адаптации модов любой сложности (оружие, одежда, профессии, крафт, 3D-модели, лут) с версии B41 на B42.20.4+ без единой ошибки.

### 9.1. Изоляция и структура папок
1. **Правило `_Port`**: Исходная папка оригинального мода — **СТРОГО READ-ONLY**. Вся разработка и адаптация ведутся исключительно в папке `<ModName>_Port/`.
2. **Иерархия B42**:
   - Файлы мода помещаются в поддиректорию `42/` (например, `<ModName>_Port/42/`).
   - В `42/mod.info`: указать `versionMin=42.0.0`.
   - Корневой `mod.info` в `<ModName>_Port/` не должен конфликтовать со специфичным для 42.

### 9.2. Адаптация скриптов предметов (`item`)
1. **Типизация предметов**:
   - Каждому предмету требуется явный `ItemType` с неймспейсом:
     - Оружие: `ItemType = base:weapon`
     - Одежда: `ItemType = base:clothing`
     - Контейнеры/сумки: `ItemType = base:container`
     - Еда: `ItemType = base:food`
     - Материалы/хлам: `ItemType = base:normal`
2. **Точки крепления (`AttachmentType`)**:
   - Использовать только канонические типы (`Holster`, `Rifle`, `Back`, `BeltLeft`, `BeltRight`).
3. **Кастомные слоты тела (`BodyLocation`)**:
   - В B42 кастомные слоты **ОБЯЗАНЫ** иметь неймспейс мода: например, `BodyLocation = remod:elbowpads` или `remod:kneepads`.
   - Попытка зарегистрировать слот без неймспейса (`ItemBodyLocation.register("name")`) выбрасывает ошибку `Default namespace 'base:...' is not allowed!`.
4. **Именование файлов скриптов (Критично!)**:
   - **НИКОГДА** не называть скрипты стандартными именами (`character_professions.txt`, `recipes.txt`, `items.txt`, `clothing.txt`).
   - Всегда добавлять префикс мода: `MyMod_items.txt`, `MyMod_professions.txt`. В противном случае движок полностью выгружает ванильные скрипты игры.

### 9.3. Новая система профессий и реестров B42
1. **Регистрация в `media/registries.lua`**:
   - Выполняется на самом раннем этапе загрузки мода:
   ```lua
   if CharacterProfession and CharacterProfession.register then
       CharacterProfession.register("modid:prof_id")
   end
   if ItemBodyLocation and ItemBodyLocation.register then
       ItemBodyLocation.register("modid:slot_id")
   end
   ```
2. **Скриптовое объявление профессии (`media/scripts/characters/MyMod_professions.txt`)**:
   ```text
   module MyMod
   {
       character_profession_definition modid:prof_id
       {
           CharacterProfession = modid:prof_id,
           Cost = 0,
           UIName = UI_prof_MyProf,
           IconPathName = profession_MyProf,
           GrantedTraits = base:desensitized,
           XPBoosts = Aiming=3;Reloading=3,
       }
   }
   ```
3. **Слоты с поддержкой нескольких предметов (`MultiItem = true`)**:
   - В `media/lua/shared/NPCs/MyMod_ExtraBodyLocations.lua`:
   ```lua
   local group = BodyLocations and BodyLocations.getGroup and BodyLocations.getGroup("Human")
   if group then
       local loc = group:getOrCreateLocation("modid:slot_id")
       if loc and loc.setMultiItem then
           loc:setMultiItem(true)
       end
   end
   ```
   Это предотвращает сбрасывание предметов друг другом (например, налокотники, наколенники и подсумки на одном персонаже).

### 9.4. Система рецептов (`craftRecipe`)
1. Синтаксис B42:
   ```text
   craftRecipe MyRecipe
   {
       time = 100,
       category = General,
       Tags = AnySurfaceCraft;InHandCraft,
       timedAction = Making,
       inputs
       {
           item 1 [Base.Hammer] mode:keep flags[Prop1],
           item 2 [Base.Nails],
           item 1 [Base.Plank],
       }
       outputs
       {
           item 1 Base.WoodenBox,
       }
   }
   ```
2. **Запрет дубликатов `Prop1`**: в секции `inputs` флаг `flags[Prop1]` может быть присвоен **только одному** предмету-инструменту. Дублирование вызывает ошибку компиляции рецепта.

### 9.5. Наряды (Outfits) и создание персонажа
1. **Ограничение движка**: В B42 `OutfitManager` инициализируется до загрузки модов, из-за чего XML-костюмы из `clothing.xml` не отображаются в окне создания персонажа.
2. **Архитектурное решение**:
   - Создать таблицу соответствия нарядов и предметов (`media/lua/shared/NPCs/MyMod_Outfits.lua`).
   - Функция безопасной экипировки:
     ```lua
     function MyMod_Outfits.dressCharacter(desc, outfit)
         if not desc or not outfit then return end
         local wornItems = desc:getWornItems()
         if wornItems then wornItems:clear() end
         for _, itemType in ipairs(outfit.items) do
             local item = instanceItem(itemType)
             if item then
                 local loc = item:getBodyLocation() -- В B42 возвращает готовый ItemBodyLocation!
                 if loc then
                     desc:setWornItem(loc, item) -- Напрямую передаем ItemBodyLocation, без ResourceLocation.of!
                 end
             end
         end
     end
     ```
   - Интеграция в интерфейс (`media/lua/client/OptionScreens/MyMod_CharacterCreation.lua`):
     - Встраивание выпадающего списка `self.outfitCombo` в `CharacterCreationMain:initClothing()` (для доступности во всех режимах игры).
     - Перехват `CharacterCreationMain:onOutfitSelected(combo)` для немедленной экипировки 3D-модели.

### 9.6. Распределение лута и спавн в зомби
1. **Инъекция в распределения контейнеров**:
   - Добавление предметов парами `"Base.ItemName", chance` в:
     - `ProceduralDistributions.list.<ListName>.items` (шкафы, аптечки, оружейные)
     - `Distributions[1]["all"]["inventorymale"].items` и `["inventoryfemale"].items`
2. **Гарантированный лут при гибели зомби (`Events.OnZombieDead`)**:
   - При боевом геймплее гарантирует выпадение валюты/материалов мода:
   ```lua
   local function onZombieDead(zombie)
       if not zombie then return end
       local inv = zombie:getInventory()
       if not inv then return end
       if ZombRand(100) < 25 then -- Использовать встроенный ZombRand(100), НЕ ZomboidGlobals!
           inv:AddItem("Base.MyMod_Item")
       end
   end
   Events.OnZombieDead.Add(onZombieDead)
   ```
   *(Предметы, добавленные в `zombie:getInventory()`, автоматически наследуются создаваемым объектом трупа `IsoDeadBody`)*.

### 9.7. Файлы локализации (Translate)
- Имена файлов переводов обязаны содержать префикс мода: `RE_UI_RU.txt`, `RE_Items_RU.txt`. Без префикса файл `UI_RU.txt` сотрет все ванильные тексты меню игры.
- Кодировка текстовых файлов: **UTF-8 с BOM (Byte Order Mark, \ufeff)** для кириллицы в Project Zomboid.
