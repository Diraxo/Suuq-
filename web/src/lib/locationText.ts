'use client';

import { useLanguageStore } from '@/store/language';

// UI strings for the location picker, Home location filter and currency choice
// — English (default), Somali and Amharic, mirroring components.locationList.*
// and home.* in the mobile app's locales.
const TEXT = {
  en: {
    cantFind: "Can't find your location? Add it.",
    searchPlaceholder: 'Enter your country, find your country easily',
    loading: 'Loading locations…',
    loadFailed: "Couldn't load locations. Check your connection and try again.",
    retry: 'Try again',
    noMatches: 'No matching location.',
    addTitle: 'Add your location',
    addHint:
      "You can keep going with your listing. An admin will review this location. Until it's approved, it won't appear as an option for other listings or in the Home location list.",
    countryLabel: 'Country',
    regionLabel: 'Region (optional)',
    nameLabel: 'City or locality',
    submit: 'Use this location',
    cancel: 'Cancel',
    nameRequired: 'Enter the location name.',
    countryRequired: 'Choose a country.',
    tooMany: 'Too many location requests today. Please try again tomorrow.',
    submitFailed: "Couldn't submit the location. Please try again.",
    pendingNote: 'Awaiting admin review',
    activeHeader: 'Where SUUQIYE is active',
    allCountriesHeader: 'All countries',
    allCountries: 'All countries',
    useWhole: 'Use all of {name}',
    exploreByLocation: 'Explore by location',
    allLocations: 'All Locations',
    allIn: 'All of {name}',
    backTo: 'Back to {name}',
    noExactMatch: 'No exact match for “{query}”. Did you mean:',
    places: 'Places',
    changeLocation: 'Search all countries and cities',
    currency: 'Currency',
    price: 'Price',
  },
  so: {
    cantFind: 'Ma heli kartid goobtaada? Ku dar.',
    searchPlaceholder: 'Geli dalkaaga, si fudud u hel',
    loading: 'Goobaha ayaa soo dhacaya…',
    loadFailed: 'Goobaha lama soo dejin karin. Hubi xiriirkaaga oo isku day mar kale.',
    retry: 'Isku day mar kale',
    noMatches: 'Goob ku habboon lama helin.',
    addTitle: 'Ku dar goobtaada',
    addHint:
      'Waad sii wadi kartaa liiska aad dhigayso. Maamule ayaa dib u eegi doona goobtan. Inta aan la ansixin, kuma muuuqan doonto liisaska kale ama liiska goobaha ee Bogga Hore.',
    countryLabel: 'Dal',
    regionLabel: 'Gobol (ikhtiyaari)',
    nameLabel: 'Magaalo ama deegaan',
    submit: 'Isticmaal goobtan',
    cancel: 'Jooji',
    nameRequired: 'Geli magaca goobta.',
    countryRequired: 'Dooro dal.',
    tooMany: 'Codsiyo goob oo badan ayaa maanta la diray. Fadlan berri isku day.',
    submitFailed: 'Goobta lama gudbin karin. Fadlan isku day mar kale.',
    pendingNote: 'Waxay sugaysaa dib u eegis maamule',
    activeHeader: 'Meesha SUUQIYE ka shaqeeyo',
    allCountriesHeader: 'Dalalka oo dhan',
    allCountries: 'Dalalka oo dhan',
    useWhole: 'Isticmaal {name} oo dhan',
    exploreByLocation: 'Ku sahan goobta',
    allLocations: 'Goobaha oo dhan',
    allIn: '{name} oo dhan',
    backTo: 'Ku noqo {name}',
    noExactMatch: '“{query}” si sax ah lama helin. Ma ahayd:',
    places: 'Goobaha',
    changeLocation: 'Raadi dalalka iyo magaalooyinka oo dhan',
    currency: 'Lacagta',
    price: 'Qiimaha',
  },
  am: {
    cantFind: 'አካባቢዎን አላገኙትም? ያክሉት።',
    searchPlaceholder: 'ሀገርዎን ያስገቡ፣ በቀላሉ ያግኙ',
    loading: 'አካባቢዎች በመጫን ላይ…',
    loadFailed: 'አካባቢዎችን መጫን አልተቻለም። ግንኙነትዎን ይፈትሹና እንደገና ይሞክሩ።',
    retry: 'እንደገና ሞክር',
    noMatches: 'የሚዛመድ አካባቢ የለም።',
    addTitle: 'አካባቢዎን ያክሉ',
    addHint:
      'ዝርዝርዎን መቀጠል ይችላሉ። አስተዳዳሪ ይህን አካባቢ ይገመግማል። እስኪፀድቅ ድረስ ለሌሎች ዝርዝሮች ወይም በመነሻ ገጽ የአካባቢ ዝርዝር ውስጥ አይታይም።',
    countryLabel: 'ሀገር',
    regionLabel: 'ክልል (አማራጭ)',
    nameLabel: 'ከተማ ወይም አካባቢ',
    submit: 'ይህን አካባቢ ተጠቀም',
    cancel: 'ሰርዝ',
    nameRequired: 'የአካባቢውን ስም ያስገቡ።',
    countryRequired: 'ሀገር ይምረጡ።',
    tooMany: 'ዛሬ ብዙ የአካባቢ ጥያቄዎች ተልከዋል። እባክዎ ነገ ይሞክሩ።',
    submitFailed: 'አካባቢውን መላክ አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
    pendingNote: 'የአስተዳዳሪ ግምገማ በመጠባበቅ ላይ',
    activeHeader: 'SUUQIYE የሚሠራባቸው ቦታዎች',
    allCountriesHeader: 'ሁሉም ሀገራት',
    allCountries: 'ሁሉም ሀገራት',
    useWhole: 'ሁሉንም የ{name} ተጠቀም',
    exploreByLocation: 'በአካባቢ ያስሱ',
    allLocations: 'ሁሉም አካባቢዎች',
    allIn: 'ሁሉም የ{name}',
    backTo: 'ወደ {name} ተመለስ',
    noExactMatch: 'ለ“{query}” ትክክለኛ ውጤት የለም። ማለትዎ ይህ ነበር፦',
    places: 'ቦታዎች',
    changeLocation: 'ሁሉንም ሀገራት እና ከተሞች ይፈልጉ',
    currency: 'ምንዛሪ',
    price: 'ዋጋ',
  },
} as const;

export type LocationTextKey = keyof (typeof TEXT)['en'];

export function useLocationText() {
  const locale = useLanguageStore((s) => s.locale);
  const dict = TEXT[locale] ?? TEXT.en;
  const t = (key: LocationTextKey, vars?: Record<string, string>) => {
    let s: string = dict[key] ?? TEXT.en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
  return { t, lang: locale };
}
