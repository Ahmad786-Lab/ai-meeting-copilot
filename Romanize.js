/* romanize.js
 * ----------------------------------------------------------------
 * Converts non-Latin scripts into Latin letters you can read out loud.
 * This is NOT translation. "मैं सोच रहा हूं" becomes "main soch raha
 * hoon", not "I am thinking".
 *
 * Covers: Devanagari (Hindi/Marathi/Nepali), Arabic script (Urdu/
 * Arabic/Farsi), Cyrillic (Russian/Ukrainian), Greek, and Japanese
 * kana.
 *
 * Kanji and Chinese characters cannot be romanized by character
 * mapping - they need a dictionary - so they pass through unchanged.
 */

(function () {
  // ---------------- Devanagari ----------------

  const DEVA_CONSONANTS = {
    क: "k",
    ख: "kh",
    ग: "g",
    घ: "gh",
    ङ: "ng",
    च: "ch",
    छ: "chh",
    ज: "j",
    झ: "jh",
    ञ: "ny",
    ट: "t",
    ठ: "th",
    ड: "d",
    ढ: "dh",
    ण: "n",
    त: "t",
    थ: "th",
    द: "d",
    ध: "dh",
    न: "n",
    प: "p",
    फ: "ph",
    ब: "b",
    भ: "bh",
    म: "m",
    य: "y",
    र: "r",
    ल: "l",
    व: "v",
    ळ: "l",
    श: "sh",
    ष: "sh",
    स: "s",
    ह: "h",
    क़: "q",
    ख़: "kh",
    ग़: "gh",
    ज़: "z",
    ड़: "r",
    ढ़: "rh",
    फ़: "f",
  };

  const DEVA_VOWELS = {
    अ: "a",
    आ: "aa",
    इ: "i",
    ई: "ee",
    उ: "u",
    ऊ: "oo",
    ऋ: "ri",
    ए: "e",
    ऐ: "ai",
    ओ: "o",
    औ: "au",
    ऑ: "o",
    ऍ: "e",
  };

  const DEVA_MATRAS = {
    "ा": "aa",
    "ि": "i",
    "ी": "ee",
    "ु": "u",
    "ू": "oo",
    "ृ": "ri",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
    "ॉ": "o",
    "ॅ": "e",
  };

  const DEVA_DIGITS = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
  };

  const VIRAMA = "्";
  const NUKTA = "़";

  // Hindi drops the inherent "a" in most positions - you write सोच but
  // say "soch", not "socha". Without this the output is unreadable, so
  // we parse into syllables and delete schwas the way a speaker would.
  function romanizeDevanagariWord(word) {
    const units = [];
    let i = 0;

    while (i < word.length) {
      let ch = word[i];

      if (word[i + 1] === NUKTA && DEVA_CONSONANTS[ch + NUKTA]) {
        ch = ch + NUKTA;
        i += 1;
      }

      if (DEVA_CONSONANTS[ch]) {
        const unit = {
          cons: DEVA_CONSONANTS[ch],
          vowel: "",
          inherent: false,
          tail: "",
        };
        const next = word[i + 1];

        if (next === VIRAMA) {
          i += 2;
        } else if (DEVA_MATRAS[next]) {
          unit.vowel = DEVA_MATRAS[next];
          i += 2;
        } else {
          unit.vowel = "a";
          unit.inherent = true;
          i += 1;
        }

        // Anusvara / visarga attach to the syllable.
        while (i < word.length && "ंँः".indexOf(word[i]) !== -1) {
          unit.tail += word[i] === "ः" ? "h" : "n";
          i += 1;
        }

        units.push(unit);
        continue;
      }

      if (DEVA_VOWELS[ch]) {
        const unit = {
          cons: "",
          vowel: DEVA_VOWELS[ch],
          inherent: false,
          tail: "",
        };
        i += 1;
        while (i < word.length && "ंँः".indexOf(word[i]) !== -1) {
          unit.tail += word[i] === "ः" ? "h" : "n";
          i += 1;
        }
        units.push(unit);
        continue;
      }

      if (DEVA_DIGITS[ch]) {
        units.push({
          cons: DEVA_DIGITS[ch],
          vowel: "",
          inherent: false,
          tail: "",
        });
        i += 1;
        continue;
      }

      if (ch === "।" || ch === "॥") {
        units.push({ cons: ".", vowel: "", inherent: false, tail: "" });
        i += 1;
        continue;
      }

      units.push({ cons: ch, vowel: "", inherent: false, tail: "" });
      i += 1;
    }

    // Rule 1: the final inherent schwa is always dropped.
    const last = units[units.length - 1];
    if (last && last.inherent && !last.tail && units.length > 1) {
      last.vowel = "";
      last.inherent = false;
    }

    // Rule 2: a medial schwa drops when the syllable after it still
    // carries a vowel. Never touch the first syllable.
    for (let k = units.length - 2; k >= 1; k--) {
      const u = units[k];
      const after = units[k + 1];
      if (u.inherent && !u.tail && after && after.vowel) {
        u.vowel = "";
        u.inherent = false;
      }
    }

    let out = units.map((u) => u.cons + u.vowel + u.tail).join("");

    // Word-final "aa" reads better as "a": रहा -> raha, not rahaa.
    out = out.replace(/aa$/, "a");

    return out;
  }

  function romanizeDevanagari(text) {
    // Split on whitespace and punctuation so each word is handled alone.
    return text.replace(/[\u0900-\u097F]+/g, (word) =>
      romanizeDevanagariWord(word)
    );
  }

  // ---------------- Arabic script (Urdu / Arabic / Farsi) ----------
  // Short vowels aren't written in Arabic script, so the output is
  // consonant-heavy. Readable, not beautiful.

  const ARABIC = {
    ا: "a",
    آ: "aa",
    أ: "a",
    إ: "i",
    ب: "b",
    پ: "p",
    ت: "t",
    ٹ: "t",
    ث: "s",
    ج: "j",
    چ: "ch",
    ح: "h",
    خ: "kh",
    د: "d",
    ڈ: "d",
    ذ: "z",
    ر: "r",
    ڑ: "r",
    ز: "z",
    ژ: "zh",
    س: "s",
    ش: "sh",
    ص: "s",
    ض: "z",
    ط: "t",
    ظ: "z",
    ع: "a",
    غ: "gh",
    ف: "f",
    ق: "q",
    ک: "k",
    ك: "k",
    گ: "g",
    ل: "l",
    م: "m",
    ن: "n",
    ں: "n",
    و: "o",
    ہ: "h",
    ھ: "h",
    ة: "h",
    ه: "h",
    ء: "'",
    ی: "i",
    ي: "i",
    ے: "e",
    ى: "a",
    "َ": "a",
    "ِ": "i",
    "ُ": "u",
    "ّ": "",
    "ْ": "",
    "ً": "an",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
    "،": ",",
    "؟": "?",
    "۔": ".",
  };

  // ---------------- Cyrillic ----------------

  const CYRILLIC = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
    і: "i",
    ї: "yi",
    є: "ye",
    ґ: "g",
  };

  // ---------------- Greek ----------------

  const GREEK = {
    α: "a",
    β: "v",
    γ: "g",
    δ: "d",
    ε: "e",
    ζ: "z",
    η: "i",
    θ: "th",
    ι: "i",
    κ: "k",
    λ: "l",
    μ: "m",
    ν: "n",
    ξ: "x",
    ο: "o",
    π: "p",
    ρ: "r",
    σ: "s",
    ς: "s",
    τ: "t",
    υ: "y",
    φ: "f",
    χ: "ch",
    ψ: "ps",
    ω: "o",
    ά: "a",
    έ: "e",
    ή: "i",
    ί: "i",
    ό: "o",
    ύ: "y",
    ώ: "o",
  };

  // ---------------- Japanese kana ----------------

  const KANA = {
    あ: "a",
    い: "i",
    う: "u",
    え: "e",
    お: "o",
    か: "ka",
    き: "ki",
    く: "ku",
    け: "ke",
    こ: "ko",
    が: "ga",
    ぎ: "gi",
    ぐ: "gu",
    げ: "ge",
    ご: "go",
    さ: "sa",
    し: "shi",
    す: "su",
    せ: "se",
    そ: "so",
    ざ: "za",
    じ: "ji",
    ず: "zu",
    ぜ: "ze",
    ぞ: "zo",
    た: "ta",
    ち: "chi",
    つ: "tsu",
    て: "te",
    と: "to",
    だ: "da",
    ぢ: "ji",
    づ: "zu",
    で: "de",
    ど: "do",
    な: "na",
    に: "ni",
    ぬ: "nu",
    ね: "ne",
    の: "no",
    は: "ha",
    ひ: "hi",
    ふ: "fu",
    へ: "he",
    ほ: "ho",
    ば: "ba",
    び: "bi",
    ぶ: "bu",
    べ: "be",
    ぼ: "bo",
    ぱ: "pa",
    ぴ: "pi",
    ぷ: "pu",
    ぺ: "pe",
    ぽ: "po",
    ま: "ma",
    み: "mi",
    む: "mu",
    め: "me",
    も: "mo",
    や: "ya",
    ゆ: "yu",
    よ: "yo",
    ら: "ra",
    り: "ri",
    る: "ru",
    れ: "re",
    ろ: "ro",
    わ: "wa",
    を: "wo",
    ん: "n",
    っ: "",
    ー: "-",
    "、": ",",
    "。": ".",
  };

  function katakanaToHiragana(text) {
    return text.replace(/[\u30A1-\u30F6]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
  }

  // ---------------- Dispatcher ----------------

  function mapChars(text, table) {
    let out = "";
    for (const ch of text) {
      const lower = ch.toLowerCase();
      if (table[lower] !== undefined) {
        const mapped = table[lower];
        // Preserve capitalisation where the source had it.
        out +=
          ch !== lower && mapped
            ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
            : mapped;
      } else {
        out += ch;
      }
    }
    return out;
  }

  function romanize(text) {
    if (!text) return text;

    // Fast path: already Latin.
    if (!/[^\u0000-\u024F\u2000-\u206F]/.test(text)) return text;

    let out = text;

    if (/[\u0900-\u097F]/.test(out)) out = romanizeDevanagari(out);
    if (/[\u0600-\u06FF\u0750-\u077F]/.test(out)) out = mapChars(out, ARABIC);
    if (/[\u0400-\u04FF]/.test(out)) out = mapChars(out, CYRILLIC);
    if (/[\u0370-\u03FF]/.test(out)) out = mapChars(out, GREEK);
    if (/[\u3040-\u30FF]/.test(out)) {
      out = mapChars(katakanaToHiragana(out), KANA);
    }

    // Collapse any double spaces the mapping introduced.
    return out.replace(/\s{2,}/g, " ").trim();
  }

  // Expose to the content script.
  window.aiCopilotRomanize = romanize;
})();
