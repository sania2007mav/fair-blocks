/**
 * UI strings. Russian is the default. Kazakh and English ship in the same
 * dictionary so a new language is one object plus an entry in LANGS.
 * Every locale must contain the same keys (enforced by tests/fairness.test.mjs).
 */

export const DICT = {
  ru: {
    title: "Честные блоки",
    score: "Очки",
    best: "Рекорд",
    streak: "Серия",
    newGame: "Новая игра",
    again: "Заново",
    gameOver: "Ход невозможен",
    gameOverHint: "Ни одна из оставшихся фигур не помещается на поле.",
    preview: "Следующие",
    previewToggle: "Показывать следующий набор",
    previewOk: "подходит",
    previewRefresh: "обновится",
    fairNote: "В каждом наборе есть хотя бы одна фигура, которая помещается на поле. Раздача не зависит от очков.",
    sound: "Звук",
    soundOn: "Включить звук",
    soundOff: "Выключить звук",
    settings: "Настройки",
    theme: "Тема",
    themeClassic: "Классика",
    themeDark: "Тёмная",
    themePastel: "Пастель",
    themeWood: "Дерево",
    lang: "Язык",
    hint: "Перетащите фигуру на поле",
    combo: "Комбо",
    line1: "линия",
    line2: "линии",
    line5: "линий",
    close: "Закрыть",
    newBest: "Новый рекорд!",
    confirmTitle: "Начать заново?",
    confirmHint: "Очки этой партии сбросятся. Рекорд сохранится.",
    confirmYes: "Да",
    confirmNo: "Нет",
    piece: "Фигура",
    boardLabel: "Игровое поле",
  },
  kk: {
    title: "Әділ блоктар",
    score: "Ұпай",
    best: "Рекорд",
    streak: "Тізбек",
    newGame: "Жаңа ойын",
    again: "Қайта",
    gameOver: "Жүріс жоқ",
    gameOverHint: "Қалған фигуралардың ешқайсысы тақтаға сыймайды.",
    preview: "Келесі",
    previewToggle: "Келесі жиынтықты көрсету",
    previewOk: "сыяды",
    previewRefresh: "жаңарады",
    fairNote: "Әр жиынтықта тақтаға сыятын кемінде бір фигура бар. Тарату ұпайға байланысты емес.",
    sound: "Дыбыс",
    soundOn: "Дыбысты қосу",
    soundOff: "Дыбысты өшіру",
    settings: "Баптаулар",
    theme: "Тақырып",
    themeClassic: "Классика",
    themeDark: "Қараңғы",
    themePastel: "Пастель",
    themeWood: "Ағаш",
    lang: "Тіл",
    hint: "Фигураны тақтаға сүйреңіз",
    combo: "Комбо",
    line1: "қатар",
    line2: "қатар",
    line5: "қатар",
    close: "Жабу",
    newBest: "Жаңа рекорд!",
    confirmTitle: "Қайта бастау керек пе?",
    confirmHint: "Осы партияның ұпайы жойылады. Рекорд сақталады.",
    confirmYes: "Иә",
    confirmNo: "Жоқ",
    piece: "Фигура",
    boardLabel: "Ойын тақтасы",
  },
  en: {
    title: "Fair Blocks",
    score: "Score",
    best: "Best",
    streak: "Streak",
    newGame: "New game",
    again: "Again",
    gameOver: "No moves left",
    gameOverHint: "None of the remaining pieces fit on the board.",
    preview: "Next",
    previewToggle: "Show the next set",
    previewOk: "fits",
    previewRefresh: "will update",
    fairNote: "Every set includes at least one piece that fits. Deals do not depend on your score.",
    sound: "Sound",
    soundOn: "Turn sound on",
    soundOff: "Turn sound off",
    settings: "Settings",
    theme: "Theme",
    themeClassic: "Classic",
    themeDark: "Dark",
    themePastel: "Pastel",
    themeWood: "Wood",
    lang: "Language",
    hint: "Drag a piece onto the board",
    combo: "Combo",
    line1: "line",
    line2: "lines",
    line5: "lines",
    close: "Close",
    newBest: "New best!",
    confirmTitle: "Start over?",
    confirmHint: "This game's score will reset. Your best score stays.",
    confirmYes: "Yes",
    confirmNo: "No",
    piece: "Piece",
    boardLabel: "Board",
  },
}

export function translate(lang, key) {
  const pack = DICT[lang] || DICT.ru
  if (pack[key] != null) return pack[key]
  if (DICT.ru[key] != null) return DICT.ru[key]
  return key
}

function pluralRu(n, one, few, many) {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few
  return many
}

export function linesLabel(lang, n) {
  const pack = DICT[lang] || DICT.ru
  if (lang === "ru") return n + " " + pluralRu(n, pack.line1, pack.line2, pack.line5)
  if (lang === "en") return n === 1 ? "1 " + pack.line1 : n + " " + pack.line2
  return n + " " + pack.line1
}

export function floatCaption(lang, { linesCleared, streak, newRecord }) {
  const parts = []
  if (linesCleared >= 2) parts.push(translate(lang, "combo") + " ×" + linesCleared)
  else if (linesCleared === 1) parts.push(linesLabel(lang, 1))
  if (streak >= 2) parts.push(translate(lang, "streak") + " ×" + streak)
  if (newRecord) parts.push(translate(lang, "newBest"))
  return parts.join(" · ")
}
