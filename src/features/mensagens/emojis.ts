export type CategoriaEmoji = { id: string; rotulo: string; emojis: string[] };

/** Emojis mais usados no atendimento; lista local, sem dependência. */
export const CATEGORIAS_EMOJI: CategoriaEmoji[] = [
  {
    id: "carinhas",
    rotulo: "Carinhas",
    emojis: [
      "😊", "😀", "😃", "😄", "😁", "😆", "😅", "😂",
      "🤣", "🙂", "😉", "😍", "🥰", "😘", "😇", "🤗",
      "😌", "😎", "🤩", "🥹", "😢", "😭", "😮", "🤔",
    ],
  },
  {
    id: "gestos",
    rotulo: "Gestos e corações",
    emojis: [
      "👍", "👏", "🙏", "🤝", "🙌", "👋", "🤞", "✌️",
      "💪", "👌", "🫶", "🤍", "❤️", "🩷", "💖", "💗",
      "💕", "💞", "💓", "💝", "🧡", "💛", "💜", "🖤",
    ],
  },
  {
    id: "beleza",
    rotulo: "Beleza e flores",
    emojis: [
      "💅", "💄", "💋", "🌸", "🌺", "🌷", "🌹", "💐",
      "✨", "🌿", "🧴", "🪞", "💆‍♀️", "💇‍♀️", "🛁", "🧖‍♀️",
      "🌼", "🌻", "🪷", "🍃", "🕯️", "🧼", "👑", "💎",
    ],
  },
  {
    id: "comemoracao",
    rotulo: "Comemoração",
    emojis: [
      "🎉", "🎂", "🎁", "🥳", "🎈", "🍾", "🥂", "⭐",
      "🌟", "🎊", "🍰", "🧁", "🎀", "🏆", "🥇", "🔥",
      "💫", "☀️", "🌈", "🍀", "📅", "⏰", "✅", "📍",
    ],
  },
];
