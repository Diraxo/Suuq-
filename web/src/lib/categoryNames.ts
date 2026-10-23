// Display names for categories and subcategories. The English names in
// data/categories.ts are the stored identifiers (listings keep "Cars", "House
// for Rent"...), so they are never changed; screens show the name in the
// active language through these helpers (locales: categoryNames.<id> and
// subcategoryNames.<id>/<English name>), falling back to the English name.
// Shared verbatim with the website (web/src/lib/categoryNames.ts).

type T = (key: string, options?: Record<string, unknown>) => string;

/** "Vehicles" -> "Gaadiidka" (by category id), or the English name when there is no translation. */
export const categoryLabel = (t: T, id: string | undefined, name?: string): string =>
  id ? t(`categoryNames.${id}`, { defaultValue: name ?? id }) : name ?? '';

/** "Cars" -> "Gaadhi" (by category id + English subcategory name). */
export const subcategoryLabel = (t: T, categoryId: string | undefined, name: string | undefined): string =>
  name ? (categoryId ? t(`subcategoryNames.${categoryId}/${name}`, { defaultValue: name }) : name) : '';
