// Generates supabase/migrations/0033_locations_seed.sql — the initial location
// directory: every country (ISO 3166-1, names in English/Somali/Amharic from
// the CLDR data bundled with Node), Somaliland as an app-specific region, plus
// current regions and main cities for Somalia, Somaliland and Ethiopia.
//
// Run: node scripts/build-locations-seed.js
// Everything seeded here is editable afterwards from Admin → Locations; the
// seed only matters for the first run of the migration (it is idempotent).
const fs = require('fs');
const path = require('path');

// ISO 3166-1 alpha-2 → official currency (ISO 4217). Territories without their
// own central bank use the controlling currency. Bulgaria joined the euro on
// 2026-01-01.
const CURRENCY = `AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN
BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:EUR BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD
CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:ANG CX:AUD CY:EUR CZ:CZK
DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR EG:EGP ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR
GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF GY:GYD
HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IQ:IQD IR:IRR IS:ISK IT:EUR JE:GBP JM:JMD JO:JOD JP:JPY
KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD
MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN
NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR PW:USD PY:PYG
QA:QAR RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:ANG SY:SYP SZ:SZL
TC:USD TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD VN:VND VU:VUV
WF:XPF WS:WST XK:EUR YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWG`
  .split(/\s+/)
  .map((p) => p.split(':'));

const dn = (l) => new Intl.DisplayNames([l], { type: 'region' });
const en = dn('en'), so = dn('so'), am = dn('am');

// Somali-market overrides (default currency + allowed choices).
const CURRENCY_OVERRIDE = {
  SO: { codes: ['USD', 'SOS'], def: 'USD' },
  ET: { codes: ['ETB', 'USD'], def: 'ETB' },
};

const lit = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a) => (a && a.length ? `array[${a.map(lit).join(', ')}]::text[]` : 'null');

// SUUQIYE serves Somalia, Somaliland and Ethiopia. Other countries can be added
// later from Admin → Locations; set ALL_COUNTRIES=1 to seed the whole world instead.
const CORE_ISO = new Set(['ET', 'SO']);
const ALL = process.env.ALL_COUNTRIES === '1';

const rows = [];
const seen = new Set();
for (const [iso, cur] of CURRENCY) {
  if (!ALL && !CORE_ISO.has(iso)) continue;
  const name = en.of(iso);
  if (!name || name === iso || seen.has(iso)) continue;
  seen.add(iso);
  const o = CURRENCY_OVERRIDE[iso];
  const codes = o ? o.codes : cur === 'USD' ? ['USD'] : [cur, 'USD'];
  rows.push({ kind: 'country', name, iso, so: so.of(iso), am: am.of(iso), codes, def: o ? o.def : cur });
}
// Somaliland — app-specific region, not an ISO country.
rows.push({ kind: 'country', name: 'Somaliland', iso: null, so: 'Soomaaliland', am: 'ሶማሌላንድ', codes: ['USD', 'SLSH'], def: 'USD', appRegion: true });

// Regions & cities. [name, so, am, aliases]
const C = (name, so, am, aliases) => ({ name, so, am, aliases });
const MARKETS = {
  Ethiopia: {
    'Addis Ababa': { am: 'አዲስ አበባ', cities: [C('Addis Ababa', null, 'አዲስ አበባ', ['Finfinne'])], featured: ['Addis Ababa'] },
    Afar: { am: 'አፋር', cities: [C('Semera', null, 'ሰመራ'), C('Asayita'), C('Dubti'), C('Gewane')] },
    Amhara: { am: 'አማራ', cities: [C('Bahir Dar', null, 'ባሕር ዳር'), C('Gondar', null, 'ጎንደር', ['Gonder']), C('Dessie', null, 'ደሴ'), C('Debre Markos'), C('Debre Birhan'), C('Kombolcha'), C('Lalibela'), C('Woldia'), C('Debre Tabor')] },
    'Benishangul-Gumuz': { am: 'ቤኒሻንጉል ጉሙዝ', cities: [C('Asosa'), C('Bambasi'), C('Gilgel Beles')] },
    'Central Ethiopia': { cities: [C('Hosaena', null, null, ['Hosanna']), C('Wolkite'), C('Butajira'), C('Durame'), C('Worabe')] },
    'Dire Dawa': { am: 'ድሬዳዋ', cities: [C('Dire Dawa', null, 'ድሬዳዋ', ['Dirre Dhabe'])] },
    Gambela: { am: 'ጋምቤላ', cities: [C('Gambela', null, 'ጋምቤላ')] },
    Harari: { am: 'ሐረሪ', cities: [C('Harar', null, 'ሐረር', ['Harer'])] },
    Oromia: { am: 'ኦሮሚያ', cities: [C('Adama', null, 'አዳማ', ['Nazret', 'Nazareth']), C('Jimma', null, 'ጅማ'), C('Bishoftu', null, 'ቢሾፍቱ', ['Debre Zeit']), C('Shashamane', null, 'ሻሸመኔ'), C('Nekemte'), C('Ambo'), C('Asella'), C('Robe'), C('Goba'), C('Metu'), C('Gimbi'), C('Sebeta'), C('Burayu'), C('Sululta'), C('Woliso'), C('Dembidolo'), C('Bule Hora'), C('Yabelo'), C('Moyale'), C('Batu', null, null, ['Ziway']), C('Mojo'), C('Dukem'), C('Fiche')] },
    Sidama: { am: 'ሲዳማ', cities: [C('Hawassa', null, 'ሃዋሳ', ['Awasa']), C('Yirgalem'), C('Aleta Wondo')] },
    Somali: {
      label: 'Somali Region',
      am: 'ሶማሌ',
      cities: [
        C('Jigjiga', 'Jigjiga', 'ጅግጅጋ', ['Jijiga']), C('Dhagaxbuur', null, 'ደገሃቡር', ['Degehabur', 'Degeh Bur']),
        C('Qabridahare', null, 'ቀብሪ ደሃር', ['Kebri Dahar', 'Kebridehar']), C('Godey', null, 'ጎዴ', ['Gode']),
        C('Wardheer', null, 'ዋርደር', ['Warder', 'Dollo (Warder)']), C('Fiiq', null, 'ፊቅ', ['Fik', 'Fiq']),
        C('Shilaabo', null, null, ['Shilavo']), C('Kalafo'), C('Dollo', null, null, ['Dolo Ado', 'Doolo']),
        C('Qabribayah', null, null, ['Kebri Beyah']), C('Baabile', null, null, ['Babile']), C('Gursum'),
        C('Awaare', null, null, ['Aware']), C('Hartisheikh', null, null, ['Hartisheikh']), C('Shinile', null, null, ['Sitti']),
        C('Erer'), C('Wajaale (Ethiopia)', null, null, ['Tog Wajale', 'Togwajaale', 'Tuuga Wajaale']),
      ],
      featured: ['Jigjiga'],
    },
    'South Ethiopia': { cities: [C('Arba Minch'), C('Dilla'), C('Jinka'), C('Konso'), C('Sawla')] },
    'South West Ethiopia': { cities: [C('Bonga'), C('Mizan Teferi'), C('Tepi'), C('Tarcha')] },
    Tigray: { am: 'ትግራይ', cities: [C('Mekelle', null, 'መቀሌ', ['Mekele']), C('Adigrat'), C('Axum', null, null, ['Aksum']), C('Shire'), C('Adwa'), C('Alamata'), C('Maychew')] },
  },
  Somaliland: {
    Awdal: { cities: [C('Boorama', null, null, ['Borama']), C('Saylac', null, null, ['Zeila']), C('Baki'), C('Lughaya')] },
    Sahil: { cities: [C('Berbera'), C('Sheekh', null, null, ['Sheikh'])] },
    'Maroodi Jeex': { cities: [C('Hargeisa', 'Hargeysa', 'ሀርጌሳ', ['Hargeysa']), C('Gabiley', null, null, ['Gebiley']), C('Wajaale', null, null, ['Wajale']), C('Salaxlay'), C('Baligubadle')], featured: ['Hargeisa'] },
    Togdheer: { cities: [C('Burco', null, null, ['Burao']), C('Oodweyne')] },
    Sanaag: { cities: [C('Ceerigaabo', null, null, ['Erigavo', 'Erigabo']), C('Ceel Afweyn', null, null, ['El Afweyn']), C('Laasqoray', null, null, ['Las Khorey'])] },
    Sool: { cities: [C('Caynabo', null, null, ['Aynabo'])] },
  },
  Somalia: {
    Banaadir: { cities: [C('Muqdisho', null, 'ሞቃዲሾ', ['Mogadishu', 'Mogadiscio'])] },
    Galmudug: { cities: [C('Dhuusamareeb', null, null, ['Dusamareb']), C('Gaalkacyo', null, null, ['Galkayo']), C('Cadaado', null, null, ['Adado']), C('Cabudwaaq', null, null, ['Abudwak'])] },
    Hirshabelle: { cities: [C('Jowhar'), C('Beledweyne', null, null, ['Beledweyne', 'Beletweyne']), C('Balcad', null, null, ['Balad'])] },
    Jubaland: { cities: [C('Kismaayo', null, null, ['Kismayo']), C('Garbahaarey', null, null, ['Garbaharey']), C('Beled Xaawo', null, null, ['Beledhawo']), C('Bardheere', null, null, ['Bardera']), C('Afmadow')] },
    Puntland: { cities: [C('Garoowe', null, null, ['Garowe']), C('Boosaaso', null, null, ['Bosaso', 'Bossaso']), C('Qardho', null, null, ['Qardo']), C('Gaalkacyo (Puntland)', null, null, ['Galkayo North'])] },
    'South West State': { cities: [C('Baydhabo', null, null, ['Baidoa']), C('Barawe', null, null, ['Brava']), C('Xudur', null, null, ['Hudur']), C('Wanlaweyn'), C('Afgooye'), C('Marka', null, null, ['Merca']), C('Qoryooley')] },
    'Northeast State': { cities: [C('Laascaanood', null, null, ['Las Anod', 'Lasanod']), C('Taleex', null, null, ['Taleh']), C('Xudun', null, null, ['Hudun'])] },
  },
};

const regionRows = [];
const cityRows = [];
for (const [country, regions] of Object.entries(MARKETS)) {
  for (const [regionName, r] of Object.entries(regions)) {
    const display = r.label ?? regionName;
    regionRows.push({ country, name: display, am: r.am ?? null });
    for (const c of r.cities) {
      cityRows.push({
        country,
        parent: display,
        ...c,
        featured: (r.featured ?? []).includes(c.name),
      });
    }
  }
}

let sql = `-- GENERATED by scripts/build-locations-seed.js — do not edit by hand; re-run the
-- script instead. Seeds the location directory (see 0032_locations_directory.sql):
-- every country, Somaliland, and current regions/cities for Somalia, Somaliland
-- and Ethiopia. Idempotent; everything here is editable later from Admin → Locations.

create or replace function pg_temp.seed_loc(
  p_kind text, p_name text, p_parent_kind text, p_parent_name text, p_root text,
  p_so text, p_am text, p_aliases text[], p_iso2 text, p_codes text[], p_default text,
  p_app_region boolean, p_featured boolean
) returns void language plpgsql as $f$
declare
  v_parent uuid;
begin
  if p_kind <> 'country' then
    select r.id into v_parent from public.locations r
    where r.kind = p_parent_kind and r.normalized_name = public.normalize_location_name(p_parent_name)
      and r.status in ('approved', 'inactive')
      and (p_parent_kind = 'country' or exists (
        select 1 from public.locations c where c.id = r.parent_id and c.kind = 'country'
          and c.normalized_name = public.normalize_location_name(p_root)))
    limit 1;
    if v_parent is null then raise exception 'seed parent not found: % / %', p_parent_name, p_root; end if;
  end if;
  -- A city created by the first draft sits directly under its country: move it
  -- under its region (keeps its id, listings and any admin edits).
  if p_kind = 'city' then
    update public.locations l
    set parent_id = v_parent,
        name_so = coalesce(l.name_so, p_so), name_am = coalesce(l.name_am, p_am),
        aliases = coalesce(l.aliases, p_aliases), is_featured = l.is_featured or p_featured
    where l.kind = 'city' and l.normalized_name = public.normalize_location_name(p_name)
      and l.status in ('pending', 'approved', 'inactive')
      and l.parent_id = (select r.parent_id from public.locations r where r.id = v_parent and r.kind = 'region');
    if found then return; end if;
  end if;
  if exists (
    select 1 from public.locations l
    where l.kind = p_kind and l.parent_id is not distinct from v_parent
      and l.normalized_name = public.normalize_location_name(p_name)
      and l.status in ('pending', 'approved', 'inactive')
  ) then return; end if;
  insert into public.locations (kind, name, parent_id, status, is_app_region, is_featured, iso2,
                                currency_codes, default_currency, name_so, name_am, aliases)
  values (p_kind, p_name, v_parent, 'approved', p_app_region, p_featured, p_iso2,
          p_codes, p_default, p_so, p_am, p_aliases);
end;
$f$;

`;

const call = (r) =>
  `select pg_temp.seed_loc(${lit(r.kind)}, ${lit(r.name)}, ${lit(r.pk)}, ${lit(r.pn)}, ${lit(r.root)}, ${lit(r.so)}, ${lit(r.am)}, ${arr(r.aliases)}, ${lit(r.iso)}, ${arr(r.codes)}, ${lit(r.def)}, ${r.appRegion ? 'true' : 'false'}, ${r.featured ? 'true' : 'false'});\n`;

sql += '-- Countries\n';
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  sql += call({ ...r, pk: null, pn: null, root: null, aliases: null });
}
sql += '\n-- Regions\n';
for (const r of regionRows) {
  sql += call({ kind: 'region', name: r.name, pk: 'country', pn: r.country, root: r.country, so: null, am: r.am, aliases: null, iso: null, codes: null, def: null });
}
sql += '\n-- Cities\n';
for (const c of cityRows) {
  sql += call({
    kind: 'city', name: c.name, pk: 'region', pn: c.parent, root: c.country, so: c.so ?? null, am: c.am ?? null,
    aliases: c.aliases ?? null, iso: null, codes: null, def: null, featured: c.featured,
  });
}

sql += `
-- Link existing listings to the directory (touches only location_id; the link
-- trigger is UPDATE OF city so it does not fire).
update public.listings li
set location_id = x.id
from (
  select distinct on (normalized_name) id, normalized_name
  from public.locations
  where status = 'approved'
  order by normalized_name, (case kind when 'city' then 0 when 'region' then 1 else 2 end), created_at
) x
where li.location_id is null and li.city is not null
  and x.normalized_name = public.normalize_location_name(li.city);
`;

const out = path.join(__dirname, '..', 'supabase', 'migrations', '0033_locations_seed.sql');
fs.writeFileSync(out, sql);
console.log(`wrote ${out}: ${rows.length} countries, ${regionRows.length} regions, ${cityRows.length} cities`);
