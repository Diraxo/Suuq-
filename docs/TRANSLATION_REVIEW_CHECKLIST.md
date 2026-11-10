# Translation review checklist — Contact for price and the new service strings

Generated 2026-10-26 (seventh key added 2026-10-27) from `locales/*/translation.json` and `locales/pending-review.json`. **Nothing below has been checked by a native speaker.** Somali and Amharic wording in section A (7 keys) was written by the assistant and is a first draft, recorded as `unreviewedDrafts` in `locales/pending-review.json`; section B is still the English placeholder in both languages.

Convention reused from the existing locale files: Somali "La xiriir …" for contact (as in *La xiriir taageerada*), Amharic polite plural verbs (*ያግኙ*, *ይወስኑ*), glossary terms Qiimaha / ዋጋ for Price. Brand names and technical identifiers (Suuq+, SUUQIYE, `priceMode`, currency codes) are not translated.

## A. Translated, NOT yet verified (7 keys)

| Done | Key | English | Somali (draft) | Amharic (draft) | Where it shows / what to check |
|---|---|---|---|---|---|
| [ ] | `post.fieldLabels.How do you charge?` | How do you charge? | Sidee ayaad lacagta u qaadataa? | ዋጋውን እንዴት ያስከፍላሉ? | Provider picks how the service is priced (radio question) |
| [ ] | `post.fieldLabels.Price is charged` | Price is charged | Qiimaha waxaa la qaadaa | ዋጋ የሚከፈለው | Label for the price-unit dropdown (answer reads e.g. "...: Maalin kasta / በቀን") |
| [ ] | `post.fieldOptions.Set a price` | Set a price | Deji qiime | ዋጋ ይወስኑ | Radio option: provider enters an amount |
| [ ] | `post.fieldOptions.Contact for price` | Contact for price | La xiriir qiimaha | ለዋጋ ያነጋግሩ | Radio option: no amount, buyers must ask |
| [ ] | `post.serviceDisplay.contactForPrice` | Contact for price | La xiriir qiimaha | ለዋጋ ያነጋግሩ | Shown instead of a price on cards, listing page, chat, offers, compare, admin, share text. Must stay SHORT |
| [ ] | `post.sections.pricing` | Pricing | Qiimaha | ዋጋ | Section heading on the service form |
| [ ] | `post.price.contactHint` | Buyers will see "Contact for price" and can message or call you to ask. | Iibsadayaashu waxay arki doonaan "La xiriir qiimaha" waxayna kuu soo diri karaan fariin ama kuu soo wici karaan si ay u weydiiyaan. | ገዢዎች "ለዋጋ ያነጋግሩ" ያያሉ፤ ለመጠየቅም መልእክት ሊልኩልዎ ወይም ሊደውሉልዎ ይችላሉ። | Hint under the price step when the provider chose Contact for price (mobile `app/post/price.tsx`, website `sell/page.tsx`). Quoted phrase must match the reviewed wording of `post.fieldOptions.Contact for price` |

Questions for the reviewers:
- Somali *La xiriir qiimaha* ("contact the price") is the shortest form that follows the existing "La xiriir …" pattern. Is it clear to a buyer, or is something like *Wac si aad u ogaato qiimaha* better (longer; may not fit on a card)?
- Somali *Qiimaha waxaa la qaadaa* + unit (*Maalin kasta*, *Toddobaad kasta*): does the sentence read naturally?
- Amharic *ለዋጋ ያነጋግሩ* vs the common *ለዋጋ ይደውሉ* ("call for price"): which do Ethiopian Somali-region and Addis users expect?
- Amharic *ዋጋ የሚከፈለው* + unit (*በቀን*, *በሳምንት*): natural?

Note: the earlier audit list of "seven" contact-price keys is not in the repository. `post.price.contactHint` is the seventh key by repository evidence: the only contact-price string used with an inline `defaultValue` and no locale entry (`app/post/price.tsx`, `web/src/app/sell/page.tsx`); a scan of every `t(key, { defaultValue })` call in app/web code found no other contact-price key missing (the only other missing key, `post.price.priceHintGrouped`, belongs to the services number-grouping hint, not to Contact for price).

## B. Still English in Somali AND Amharic — 222 keys (listed in `locales/pending-review.json`)

These are new service-form strings (22 trades, price units, availability). The app shows the English text until a translation is reviewed; tests keep this list exact. When a key is translated, delete it from `locales/pending-review.json` (a test fails otherwise) and run `node scripts/sync-web-text.js`.

| Group | Keys |
|---|---|
| `post.examples` | 8 |
| `post.fieldHints` | 2 |
| `post.fieldLabels` | 23 |
| `post.fieldOptions` | 167 |
| `post.sections` | 3 |
| `post.serviceDisplay` | 1 |
| `post.titleExamples` | 9 |
| `subcategoryNames` | 9 |

One more new key is identical in all languages on purpose and needs no translation: `components.listingCard.discountOff` = `-{{percent}}%`.

### `post.examples` (8)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `examples.4 passengers` | 4 passengers |
| [ ] | [ ] | `examples.5 to 100 kVA` | 5 to 100 kVA |
| [ ] | [ ] | `examples.City centre to the airport` | City centre to the airport |
| [ ] | [ ] | `examples.District 01 and nearby towns` | District 01 and nearby towns |
| [ ] | [ ] | `examples.Hodan Electric Services` | Hodan Electric Services |
| [ ] | [ ] | `examples.Mathematics, English` | Mathematics, English |
| [ ] | [ ] | `examples.Whole city, pickup from shops` | Whole city, pickup from shops |
| [ ] | [ ] | `examples.Within 2 hours` | Within 2 hours |

### `post.fieldHints` (2)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `fieldHints.Districts, towns or neighborhoods you cover` | Districts, towns or neighborhoods you cover. |
| [ ] | [ ] | `fieldHints.Optional — leave blank to use the name on your profile` | Optional — leave blank to use the name on your profile. |

### `post.fieldLabels` (23)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `fieldLabels.Available days` | Available days |
| [ ] | [ ] | `fieldLabels.Available from` | Available from |
| [ ] | [ ] | `fieldLabels.Available until` | Available until |
| [ ] | [ ] | `fieldLabels.Booking` | Booking |
| [ ] | [ ] | `fieldLabels.Delivery vehicle` | Delivery vehicle |
| [ ] | [ ] | `fieldLabels.Emergency or 24-hour service` | Emergency or 24-hour service |
| [ ] | [ ] | `fieldLabels.Estimated delivery time` | Estimated delivery time |
| [ ] | [ ] | `fieldLabels.Generator type` | Generator type |
| [ ] | [ ] | `fieldLabels.Passenger or load capacity` | Passenger or load capacity |
| [ ] | [ ] | `fieldLabels.Pickup and delivery areas` | Pickup and delivery areas |
| [ ] | [ ] | `fieldLabels.Provider type` | Provider type |
| [ ] | [ ] | `fieldLabels.Routes you serve` | Routes you serve |
| [ ] | [ ] | `fieldLabels.Same-day service` | Same-day service |
| [ ] | [ ] | `fieldLabels.Service area` | Service area |
| [ ] | [ ] | `fieldLabels.Service frequency` | Service frequency |
| [ ] | [ ] | `fieldLabels.Shooting setting` | Shooting setting |
| [ ] | [ ] | `fieldLabels.Subjects or skills taught` | Subjects or skills taught |
| [ ] | [ ] | `fieldLabels.Supported capacity` | Supported capacity |
| [ ] | [ ] | `fieldLabels.Vehicle type` | Vehicle type |
| [ ] | [ ] | `fieldLabels.What you offer` | What you offer |
| [ ] | [ ] | `fieldLabels.Where you work` | Where you work |
| [ ] | [ ] | `fieldLabels.Work for` | Work for |
| [ ] | [ ] | `fieldLabels.Your name or company name` | Your name or company name |

### `post.fieldOptions` (167)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `fieldOptions.Accounting` | Accounting |
| [ ] | [ ] | `fieldOptions.After-construction cleaning` | After-construction cleaning |
| [ ] | [ ] | `fieldOptions.Air conditioner` | Air conditioner |
| [ ] | [ ] | `fieldOptions.Appointment required` | Appointment required |
| [ ] | [ ] | `fieldOptions.At my place` | At my place |
| [ ] | [ ] | `fieldOptions.Auto electrician` | Auto electrician |
| [ ] | [ ] | `fieldOptions.Bajaj` | Bajaj |
| [ ] | [ ] | `fieldOptions.Bajaj mechanic` | Bajaj mechanic |
| [ ] | [ ] | `fieldOptions.Bajaj ride` | Bajaj ride |
| [ ] | [ ] | `fieldOptions.Barber` | Barber |
| [ ] | [ ] | `fieldOptions.Bicycle` | Bicycle |
| [ ] | [ ] | `fieldOptions.Body work & painting` | Body work & painting |
| [ ] | [ ] | `fieldOptions.Building` | Building |
| [ ] | [ ] | `fieldOptions.Business registration` | Business registration |
| [ ] | [ ] | `fieldOptions.Call first` | Call first |
| [ ] | [ ] | `fieldOptions.Car` | Car |
| [ ] | [ ] | `fieldOptions.Car mechanic` | Car mechanic |
| [ ] | [ ] | `fieldOptions.Carpentry` | Carpentry |
| [ ] | [ ] | `fieldOptions.Catering` | Catering |
| [ ] | [ ] | `fieldOptions.Company` | Company |
| [ ] | [ ] | `fieldOptions.Computer repair` | Computer repair |
| [ ] | [ ] | `fieldOptions.Computer skills` | Computer skills |
| [ ] | [ ] | `fieldOptions.Consulting` | Consulting |
| [ ] | [ ] | `fieldOptions.Cooker & microwave` | Cooker & microwave |
| [ ] | [ ] | `fieldOptions.DJ & sound` | DJ & sound |
| [ ] | [ ] | `fieldOptions.Decoration` | Decoration |
| [ ] | [ ] | `fieldOptions.Decorative finishes` | Decorative finishes |
| [ ] | [ ] | `fieldOptions.Deep cleaning` | Deep cleaning |
| [ ] | [ ] | `fieldOptions.Drainage` | Drainage |
| [ ] | [ ] | `fieldOptions.Entertainment` | Entertainment |
| [ ] | [ ] | `fieldOptions.Errands` | Errands |
| [ ] | [ ] | `fieldOptions.Event filming` | Event filming |
| [ ] | [ ] | `fieldOptions.Event planning` | Event planning |
| [ ] | [ ] | `fieldOptions.Events` | Events |
| [ ] | [ ] | `fieldOptions.Every two weeks` | Every two weeks |
| [ ] | [ ] | `fieldOptions.Exam preparation` | Exam preparation |
| [ ] | [ ] | `fieldOptions.Exterior painting` | Exterior painting |
| [ ] | [ ] | `fieldOptions.Fabrication & welding` | Fabrication & welding |
| [ ] | [ ] | `fieldOptions.Food delivery` | Food delivery |
| [ ] | [ ] | `fieldOptions.Freezer` | Freezer |
| [ ] | [ ] | `fieldOptions.Freight & cargo` | Freight & cargo |
| [ ] | [ ] | `fieldOptions.Friday` | Friday |
| [ ] | [ ] | `fieldOptions.General maintenance` | General maintenance |
| [ ] | [ ] | `fieldOptions.Goods delivery` | Goods delivery |
| [ ] | [ ] | `fieldOptions.Hair` | Hair |
| [ ] | [ ] | `fieldOptions.Henna` | Henna |
| [ ] | [ ] | `fieldOptions.House cleaning` | House cleaning |
| [ ] | [ ] | `fieldOptions.House moving` | House moving |
| [ ] | [ ] | `fieldOptions.Household assistance` | Household assistance |
| [ ] | [ ] | `fieldOptions.I deliver` | I deliver |
| [ ] | [ ] | `fieldOptions.I travel to customers` | I travel to customers |
| [ ] | [ ] | `fieldOptions.IT support & troubleshooting` | IT support & troubleshooting |
| [ ] | [ ] | `fieldOptions.Individual` | Individual |
| [ ] | [ ] | `fieldOptions.Indoor` | Indoor |
| [ ] | [ ] | `fieldOptions.Industrial` | Industrial |
| [ ] | [ ] | `fieldOptions.Installation` | Installation |
| [ ] | [ ] | `fieldOptions.Intercity transport` | Intercity transport |
| [ ] | [ ] | `fieldOptions.Interior painting` | Interior painting |
| [ ] | [ ] | `fieldOptions.Internet connection` | Internet connection |
| [ ] | [ ] | `fieldOptions.Inverters & batteries` | Inverters & batteries |
| [ ] | [ ] | `fieldOptions.Languages` | Languages |
| [ ] | [ ] | `fieldOptions.Laundry` | Laundry |
| [ ] | [ ] | `fieldOptions.Leak repair` | Leak repair |
| [ ] | [ ] | `fieldOptions.Legal` | Legal |
| [ ] | [ ] | `fieldOptions.Lighting` | Lighting |
| [ ] | [ ] | `fieldOptions.Loading & unloading` | Loading & unloading |
| [ ] | [ ] | `fieldOptions.Logo & branding` | Logo & branding |
| [ ] | [ ] | `fieldOptions.MC / host` | MC / host |
| [ ] | [ ] | `fieldOptions.Maintenance` | Maintenance |
| [ ] | [ ] | `fieldOptions.Makeup` | Makeup |
| [ ] | [ ] | `fieldOptions.Masonry` | Masonry |
| [ ] | [ ] | `fieldOptions.Massage & spa` | Massage & spa |
| [ ] | [ ] | `fieldOptions.Minibus` | Minibus |
| [ ] | [ ] | `fieldOptions.Mobile app development` | Mobile app development |
| [ ] | [ ] | `fieldOptions.Monday` | Monday |
| [ ] | [ ] | `fieldOptions.Motorcycle` | Motorcycle |
| [ ] | [ ] | `fieldOptions.Motorcycle mechanic` | Motorcycle mechanic |
| [ ] | [ ] | `fieldOptions.Motorcycle ride` | Motorcycle ride |
| [ ] | [ ] | `fieldOptions.Nails` | Nails |
| [ ] | [ ] | `fieldOptions.Network cabling` | Network cabling |
| [ ] | [ ] | `fieldOptions.Networking` | Networking |
| [ ] | [ ] | `fieldOptions.Office cleaning` | Office cleaning |
| [ ] | [ ] | `fieldOptions.Office moving` | Office moving |
| [ ] | [ ] | `fieldOptions.On foot` | On foot |
| [ ] | [ ] | `fieldOptions.One-time` | One-time |
| [ ] | [ ] | `fieldOptions.Other IT work` | Other IT work |
| [ ] | [ ] | `fieldOptions.Other appliances` | Other appliances |
| [ ] | [ ] | `fieldOptions.Other business services` | Other business services |
| [ ] | [ ] | `fieldOptions.Other cleaning` | Other cleaning |
| [ ] | [ ] | `fieldOptions.Other construction work` | Other construction work |
| [ ] | [ ] | `fieldOptions.Other design` | Other design |
| [ ] | [ ] | `fieldOptions.Other electrical work` | Other electrical work |
| [ ] | [ ] | `fieldOptions.Other events` | Other events |
| [ ] | [ ] | `fieldOptions.Other painting work` | Other painting work |
| [ ] | [ ] | `fieldOptions.Other personal care` | Other personal care |
| [ ] | [ ] | `fieldOptions.Other photography` | Other photography |
| [ ] | [ ] | `fieldOptions.Other plumbing work` | Other plumbing work |
| [ ] | [ ] | `fieldOptions.Other service` | Other service |
| [ ] | [ ] | `fieldOptions.Other transport` | Other transport |
| [ ] | [ ] | `fieldOptions.Other video work` | Other video work |
| [ ] | [ ] | `fieldOptions.Outdoor` | Outdoor |
| [ ] | [ ] | `fieldOptions.Parcels & documents` | Parcels & documents |
| [ ] | [ ] | `fieldOptions.Per delivery` | Per delivery |
| [ ] | [ ] | `fieldOptions.Per event` | Per event |
| [ ] | [ ] | `fieldOptions.Per hour` | Per hour |
| [ ] | [ ] | `fieldOptions.Per item` | Per item |
| [ ] | [ ] | `fieldOptions.Per package` | Per package |
| [ ] | [ ] | `fieldOptions.Per project` | Per project |
| [ ] | [ ] | `fieldOptions.Per service` | Per service |
| [ ] | [ ] | `fieldOptions.Per session` | Per session |
| [ ] | [ ] | `fieldOptions.Per trip` | Per trip |
| [ ] | [ ] | `fieldOptions.Per video` | Per video |
| [ ] | [ ] | `fieldOptions.Per visit` | Per visit |
| [ ] | [ ] | `fieldOptions.Pickup` | Pickup |
| [ ] | [ ] | `fieldOptions.Pickup / truck hire` | Pickup / truck hire |
| [ ] | [ ] | `fieldOptions.Pipes` | Pipes |
| [ ] | [ ] | `fieldOptions.Portraits` | Portraits |
| [ ] | [ ] | `fieldOptions.Posters & print` | Posters & print |
| [ ] | [ ] | `fieldOptions.Printing & copying` | Printing & copying |
| [ ] | [ ] | `fieldOptions.Products` | Products |
| [ ] | [ ] | `fieldOptions.Promotional videos` | Promotional videos |
| [ ] | [ ] | `fieldOptions.Real estate` | Real estate |
| [ ] | [ ] | `fieldOptions.Refrigerator` | Refrigerator |
| [ ] | [ ] | `fieldOptions.Regular contract` | Regular contract |
| [ ] | [ ] | `fieldOptions.Remote / online` | Remote / online |
| [ ] | [ ] | `fieldOptions.Repair` | Repair |
| [ ] | [ ] | `fieldOptions.Repair & fault finding` | Repair & fault finding |
| [ ] | [ ] | `fieldOptions.Roofing` | Roofing |
| [ ] | [ ] | `fieldOptions.Saturday` | Saturday |
| [ ] | [ ] | `fieldOptions.School subjects` | School subjects |
| [ ] | [ ] | `fieldOptions.Servicing` | Servicing |
| [ ] | [ ] | `fieldOptions.Short-form & social media` | Short-form & social media |
| [ ] | [ ] | `fieldOptions.Skin care` | Skin care |
| [ ] | [ ] | `fieldOptions.Social media graphics` | Social media graphics |
| [ ] | [ ] | `fieldOptions.Software development` | Software development |
| [ ] | [ ] | `fieldOptions.Solar / electrical work` | Solar / electrical work |
| [ ] | [ ] | `fieldOptions.Solar panels` | Solar panels |
| [ ] | [ ] | `fieldOptions.Solar water pumping` | Solar water pumping |
| [ ] | [ ] | `fieldOptions.Storage` | Storage |
| [ ] | [ ] | `fieldOptions.Studio` | Studio |
| [ ] | [ ] | `fieldOptions.Sunday` | Sunday |
| [ ] | [ ] | `fieldOptions.TV` | TV |
| [ ] | [ ] | `fieldOptions.Taxi` | Taxi |
| [ ] | [ ] | `fieldOptions.Thursday` | Thursday |
| [ ] | [ ] | `fieldOptions.Tiling` | Tiling |
| [ ] | [ ] | `fieldOptions.Translation` | Translation |
| [ ] | [ ] | `fieldOptions.Troubleshooting` | Troubleshooting |
| [ ] | [ ] | `fieldOptions.Truck` | Truck |
| [ ] | [ ] | `fieldOptions.Truck / heavy vehicle` | Truck / heavy vehicle |
| [ ] | [ ] | `fieldOptions.Tuesday` | Tuesday |
| [ ] | [ ] | `fieldOptions.Tyres` | Tyres |
| [ ] | [ ] | `fieldOptions.UI design` | UI design |
| [ ] | [ ] | `fieldOptions.University subjects` | University subjects |
| [ ] | [ ] | `fieldOptions.Van` | Van |
| [ ] | [ ] | `fieldOptions.Video editing` | Video editing |
| [ ] | [ ] | `fieldOptions.Vocational training` | Vocational training |
| [ ] | [ ] | `fieldOptions.Walk-ins welcome` | Walk-ins welcome |
| [ ] | [ ] | `fieldOptions.Washing machine` | Washing machine |
| [ ] | [ ] | `fieldOptions.Water pumps` | Water pumps |
| [ ] | [ ] | `fieldOptions.Water tanks` | Water tanks |
| [ ] | [ ] | `fieldOptions.Website development` | Website development |
| [ ] | [ ] | `fieldOptions.Wedding videos` | Wedding videos |
| [ ] | [ ] | `fieldOptions.Weddings` | Weddings |
| [ ] | [ ] | `fieldOptions.Wednesday` | Wednesday |
| [ ] | [ ] | `fieldOptions.Weekly` | Weekly |
| [ ] | [ ] | `fieldOptions.Wi-Fi setup` | Wi-Fi setup |
| [ ] | [ ] | `fieldOptions.Wiring` | Wiring |

### `post.sections` (3)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `sections.availability` | Availability |
| [ ] | [ ] | `sections.provider` | About the provider |
| [ ] | [ ] | `sections.service` | The service |

### `post.serviceDisplay` (1)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `serviceDisplay.hours` | Working hours |

### `post.titleExamples` (9)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `titleExamples.services/Appliance Repair` | Refrigerator and freezer repair at your home |
| [ ] | [ ] | `titleExamples.services/Business Services` | Accounting and bookkeeping for small businesses |
| [ ] | [ ] | `titleExamples.services/Construction & Maintenance` | Welding and metal gate fabrication |
| [ ] | [ ] | `titleExamples.services/Delivery & Courier` | Same-day parcel delivery in the city |
| [ ] | [ ] | `titleExamples.services/Events & Catering` | Wedding catering and event decoration |
| [ ] | [ ] | `titleExamples.services/Graphic Design` | Logo and social media design |
| [ ] | [ ] | `titleExamples.services/Moving & Logistics` | House moving with pickup truck and loaders |
| [ ] | [ ] | `titleExamples.services/Other Services` | Describe the service you offer |
| [ ] | [ ] | `titleExamples.services/Video Production` | Wedding and promo video editing |

### `subcategoryNames` (9)

| Somali | Amharic | Key | English |
|---|---|---|---|
| [ ] | [ ] | `subcategoryNames.services/Appliance Repair` | Appliance Repair |
| [ ] | [ ] | `subcategoryNames.services/Business Services` | Business Services |
| [ ] | [ ] | `subcategoryNames.services/Construction & Maintenance` | Construction & Maintenance |
| [ ] | [ ] | `subcategoryNames.services/Delivery & Courier` | Delivery & Courier |
| [ ] | [ ] | `subcategoryNames.services/Events & Catering` | Events & Catering |
| [ ] | [ ] | `subcategoryNames.services/Graphic Design` | Graphic Design |
| [ ] | [ ] | `subcategoryNames.services/Moving & Logistics` | Moving & Logistics |
| [ ] | [ ] | `subcategoryNames.services/Other Services` | Other Services |
| [ ] | [ ] | `subcategoryNames.services/Video Production` | Video Production |
