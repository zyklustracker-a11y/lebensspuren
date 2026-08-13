// Fragenkatalog „Lebensspuren"
// Die Fragen stammen unverändert aus dem App-Konzept.
// Daten getrennt vom Code: Neue Fragen einfach hier ergänzen –
// jede Frage bekommt automatisch eine stabile ID aus Kategorie + Position.

export const CATEGORIES = [
  {
    id: 'kindheit',
    title: 'Kindheit & Familie',
    icon: '🏠',
    questions: [
      'Erzähl mir von dem Haus, in dem du aufgewachsen bist.',
      'Wie roch und klang ein ganz normaler Sonntag in deiner Kindheit?',
      'Wovor hattest du als Kind am meisten Angst – und wie ging das weg?',
      'Was hast du erst als Erwachsener über deine Eltern verstanden?',
      'Welche Regel deiner Eltern fandest du damals unfair – und wie siehst du sie heute?',
      'Was war das erste Mal, dass du dich richtig erwachsen gefühlt hast?',
    ],
  },
  {
    id: 'arbeit',
    title: 'Arbeit & Beruf',
    icon: '🛠️',
    questions: [
      'Was war der größte Fehler in deinem Berufsleben?',
      'Wie bist du zu deinem Beruf gekommen – war es Plan oder Zufall?',
      'Auf welche Leistung bist du bis heute stolz, auch wenn nie jemand davon erfahren hat?',
      'Gab es einen Moment, in dem du alles hinschmeißen wolltest? Warum hast du es (nicht) getan?',
      'Wer hat dir beruflich am meisten beigebracht, und was genau?',
      'Was würdest du deinem 25-jährigen Ich über Arbeit sagen?',
    ],
  },
  {
    id: 'liebe',
    title: 'Liebe & Beziehungen',
    icon: '❤️',
    questions: [
      'Was würdest du jungen Menschen über Ehe oder Partnerschaft sagen?',
      'Wie habt ihr euch kennengelernt – und woher wusstest du, dass es ernst ist?',
      'Was war die schwerste Zeit in eurer Beziehung, und wie seid ihr da durchgekommen?',
      'Was bedeutet Liebe für dich heute – anders als mit 20?',
      'Welche Freundschaft hat dein Leben geprägt, und warum hat sie gehalten (oder nicht)?',
      'Was hast du über das Verzeihen gelernt?',
    ],
  },
  {
    id: 'geld',
    title: 'Geld & Entscheidungen',
    icon: '⚖️',
    questions: [
      'Welche Entscheidung hat dir langfristig am meisten gebracht?',
      'Was war deine schlechteste Geldentscheidung – und was hat sie dich gelehrt?',
      'Gab es eine Entscheidung, die du aus Angst getroffen hast? Wie ging sie aus?',
      'Wann hast du gegen den Rat aller anderen gehandelt – und was kam dabei heraus?',
      'Was ist der Unterschied zwischen sparsam und geizig?',
      'Welche Weggabelung in deinem Leben denkst du dir manchmal anders aus?',
    ],
  },
  {
    id: 'lehren',
    title: 'Lehren fürs Leben',
    icon: '🌟',
    questions: [
      'Welche drei Dinge sollte jeder Enkel wissen?',
      'Was hast du erst spät im Leben gelernt und wünschst, du hättest es früher gewusst?',
      'Worüber haben sich die Menschen zu deiner Zeit Sorgen gemacht, das sich als unwichtig herausstellte?',
      'Was bereust du – und was bereust du ausdrücklich nicht?',
      'Woran erkennst du einen guten Menschen?',
      'Was soll von dir in Erinnerung bleiben, wenn alles andere vergessen ist?',
    ],
  },
  {
    id: 'zeitgeschichte',
    title: 'Zeitgeschichte erlebt',
    icon: '🕰️',
    questions: [
      'Wo warst du, als der Mauerfall oder die Mondlandung passierte – oder ein anderes prägendes Ereignis deiner Generation?',
      'Was konnte man damals kaufen, was es heute nicht mehr gibt – und umgekehrt?',
      'Wie hat sich dein Heimatort in deinem Leben verändert?',
    ],
  },
];

// Flache Liste aller Fragen mit stabilen IDs, in Katalog-Reihenfolge.
export const ALL_QUESTIONS = CATEGORIES.flatMap((cat) =>
  cat.questions.map((text, i) => ({
    qid: `${cat.id}-${i + 1}`,
    text,
    categoryId: cat.id,
    categoryTitle: cat.title,
    categoryIcon: cat.icon,
  }))
);

export function questionByQid(qid) {
  return ALL_QUESTIONS.find((q) => q.qid === qid) || null;
}
