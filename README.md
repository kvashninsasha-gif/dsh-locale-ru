# dsh-locale-ru

**Русский язык для DeepSeek Harness** · Russian (Русский) UI for DeepSeek Harness

Плагин добавляет русский язык в веб-интерфейс DSH рядом со встроенными **中文** и
**English**: **2615 строк интерфейса в 58 разделах** (namespace), извлечённых из
всех 71 клиентского плагина `@deepseek-ai/dsh-client-*` версии `0.2.0-rc.2`
(диалог, боковые панели, настройки, цели, задания, субагенты, траектория,
одобрения, плагины, терминал, файлы, планы, голосовой ввод и т. д.).

- **Штатный механизм локализации.** Пакет не переписывает DOM: он регистрирует
  язык через `ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })`
  и по одному словарю на namespace через `ctx.locale.register(ns, 'ru', dict)`.
- **Fallback `ru → en`.** Любая непереведённая строка (в том числе добавленная
  будущими релизами DSH) показывается по-английски, а не как «сырой» ключ.
- **Полная обратимость.** Все регистрации живут в `ctx.effect`, поэтому
  отключение или удаление бандла возвращает интерфейс к английскому и убирает
  «Русский» из списка языков.

## Установка

### 1. Как бандл DSH (рекомендуется)

Пакет объявляет `dsh.bundle.patch`, поэтому страница **Plugins** в веб-интерфейсе
и CLI ставят его одной командой:

```bash
dsh plugin --profile desktop add github:kvashninsasha-gif/dsh-locale-ru
```

Для профиля `web` (CLI-версия DSH):

```bash
dsh plugin --profile web add github:kvashninsasha-gif/dsh-locale-ru
dsh web
```

После установки откройте **Настройки → Общие → Язык** и выберите **Русский**.
Lang может подхватиться автоматически: пока язык не выбран явно, DSH берёт
первый поддерживаемый язык из `navigator.languages`, поэтому в браузере с
русским языком интерфейс переключится сам.

### 2. Вручную, без менеджера пакетов

Скопируйте каталог пакета в профиль и добавьте одну запись в
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: locale-ru
      name: './plugins/dsh-locale-ru/lib/index.js'
```

Этот способ не трогает `package.json`/lock-файл профиля. Не используйте его
одновременно с установкой бандла из пункта 1: имя пакета должно разрешаться из
одного источника, иначе загрузчик сообщит о конфликте.

### Удаление

```bash
dsh plugin --profile desktop remove dsh-locale-ru
```

или для ручной установки — удалить каталог `plugins/dsh-locale-ru` и запись
`locale-ru` из `cordis.patch.yml`. Язык в настройках после этого вернётся к
английскому/китайскому.

## Структура

| Путь | Что это |
|---|---|
| `lib/client.js` | Браузерная половина: язык + все словари (генерируется) |
| `lib/index.js` | Хост-половина: пустой `apply`, нужна загрузчику для строки плагина |
| `cordis.patch.yml` | Патч бандла: монтирует строку `locale-ru` в выбранные профили |
| `source/en.json` | Извлечённые английские (и китайские) исходники по namespace |
| `source/ru.json` | Русские переводы (правится руками) |
| `tools/` | Сборка, проверки и скрипты извлечения словарей из приложения |

## Разработка

```bash
npm run build   # source/*.json → lib/client.js (падает, если перевод неполный)
npm run check   # полнота, плейсхолдеры, актуальность бандла, рантайм-тест регистраций
```

`npm run check` не требует установки зависимостей: это обычный Node.js ≥ 22.
Он проверяет, что каждый английский ключ переведён, что все ICU-плейсхолдеры
(`{name}`, `{count}`, …) сохранились, что `lib/client.js` не устарел и что пакет
при применении регистрирует язык и все namespace, а при выгрузке снимает их.

### Обновление под новую версию DSH

Строки живут в собранных бандлах клиентских плагинов внутри `app.asar`, поэтому
при обновлении приложения словари нужно переизвлечь:

```bash
APP="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai"

# 1. распаковать app.asar (простой читатель asar, без зависимостей)
node tools/asar-extract.mjs "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" extracted/app

# 2. извлечь словари: статически и (для динамических регистраций) запуском бандлов
node tools/extract-locales-static.mjs "$APP" extracted/locales-static.json
node tools/extract-locales.mjs        "$APP" extracted/locales-extract.json
node tools/merge-locales.mjs extracted/locales-static.json extracted/locales-extract.json source/en.json

# 3. новые/изменившиеся ключи останутся английскими (fallback ru → en),
#    переведите их в source/ru.json и пересоберите бандл
npm run build && npm run check
```

`source/en.json` можно смело обновлять: `npm run check` покажет, каких
переводов не хватает и где разошлись плейсхолдеры.

## Ограничения

- **Экран загрузки** («HARNESS», «Loading plugins…», «Failed to load plugins») —
  строки внутри собранного шелла приложения (`dsh-web-frontend`), вне системы
  словарей локали; внешним языковым пакетом не переопределяются.
- **Текст, локализуемый хостом** через `LocalizedText` (например описания части
  slash-команд вроде `/model`) резолвится по картам внутри самих пакетов; это
  задокументированное ограничение `dsh-client-locale`, и языковой пакет его не
  меняет.
- **Версия.** Словари сняты с DSH `0.2.0-rc.2`; на других версиях новые ключи
  будут английскими до пересборки. `peerDependencies` на пакеты DSH намеренно
  не объявлены, чтобы установка не блокировалась проверкой совместимости.

---

<details>
<summary><b>English</b></summary>

`dsh-locale-ru` adds Russian to the DeepSeek Harness web UI next to the built-in
中文 and English. It is a standard DSH client plugin: **2615 interface strings
across 58 namespaces**, extracted from every `@deepseek-ai/dsh-client-*` plugin of
DSH `0.2.0-rc.2`.

```bash
dsh plugin --profile desktop add github:kvashninsasha-gif/dsh-locale-ru
```

Then pick **Русский** in *Settings → General → Language*. Lookup falls back
`ru → en`, so anything untranslated stays English instead of showing a raw key,
and disabling the bundle removes the language and every dictionary again.

`npm run build` regenerates `lib/client.js` from `source/en.json` + `source/ru.json`;
`npm run check` validates completeness, ICU placeholders, bundle freshness and the
runtime registrations without any dependencies (Node ≥ 22).

</details>
