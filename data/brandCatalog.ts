// Brand → model catalogs behind the "Brand" / "Model" pickers (see CategoryField.catalog).
//
// Brand and model names are DATA, never translation keys: "Toyota" and "Land Cruiser"
// are shown exactly as written in English, Somali and Amharic. The value a seller picks
// is stored as the plain string the old free-text field already stored, so listings
// saved before the pickers existed stay readable and editable (an unknown brand or model
// is simply kept as typed).
//
// ORDER IS AN EDITORIAL SEED, NOT STATISTICS. The brands listed first in `popular`, and the
// first models listed under a brand, are a hand-picked starting list for the Horn of Africa
// market — nobody has measured them. The picker labels that group "Common", never "Most
// sold" or similar. When real listing counts exist, rank by those instead and keep this
// file only as the fallback. Every brand and model is also reachable by search and the A–Z list.

export type CatalogSet = {
  /** Brands shown first (editorial seed). Every brand in `models` is still listed A–Z below. */
  popular: string[];
  /** brand → models, most commonly seen first (editorial seed). An empty list means "brand only": the model stays a plain text field. */
  models: Record<string, string[]>;
};

export const CATALOGS: Record<string, CatalogSet> = {
  // Cars and SUVs share one set: many models (RAV4, Prado, X-Trail) are sold under both subcategories.
  cars: {
    popular: ['Toyota', 'Suzuki', 'Nissan', 'Hyundai', 'Kia', 'Honda', 'Mitsubishi', 'Mazda', 'Lexus', 'Mercedes-Benz'],
    models: {
      Toyota: ['Corolla', 'Land Cruiser', 'Prado', 'RAV4', 'Vitz', 'Camry', 'Yaris', 'Premio', 'Allion', 'Axio', 'Fielder', 'Probox', 'Succeed', 'Passo', 'Harrier', 'Rush', 'Fortuner', 'Corolla Cross', 'Avanza', 'Noah', 'Voxy', 'Alphard', 'Crown', 'Mark X', 'IST', 'Wish', 'Sienta', 'C-HR', 'Ractis'],
      Suzuki: ['Swift', 'Alto', 'Vitara', 'Grand Vitara', 'Jimny', 'Dzire', 'Baleno', 'Ertiga', 'Every', 'Wagon R', 'Celerio', 'S-Presso', 'Ignis', 'Ciaz', 'SX4'],
      Nissan: ['Sunny', 'X-Trail', 'Patrol', 'Tiida', 'Note', 'Juke', 'Qashqai', 'March', 'Micra', 'Almera', 'Altima', 'Maxima', 'Murano', 'Pathfinder', 'Kicks', 'Serena', 'Cube'],
      Hyundai: ['Accent', 'Elantra', 'Tucson', 'Santa Fe', 'i10', 'i20', 'i30', 'Grand i10', 'Sonata', 'Creta', 'Kona', 'Venue', 'Palisade'],
      Kia: ['Picanto', 'Rio', 'Cerato', 'Sportage', 'Sorento', 'Optima', 'Seltos', 'Sonet', 'Carnival', 'Soul', 'Stonic'],
      Honda: ['Civic', 'Accord', 'Fit', 'CR-V', 'HR-V', 'Jazz', 'City', 'Vezel', 'Freed', 'Stepwgn', 'Odyssey', 'Pilot', 'Insight'],
      Mitsubishi: ['Pajero', 'Outlander', 'Lancer', 'ASX', 'Pajero Sport', 'Eclipse Cross', 'Mirage', 'Delica'],
      Mazda: ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-5', 'CX-9', 'Demio', 'Axela', 'Atenza'],
      Lexus: ['RX', 'LX', 'GX', 'ES', 'IS', 'GS', 'LS', 'NX', 'UX'],
      'Mercedes-Benz': ['C-Class', 'E-Class', 'S-Class', 'A-Class', 'G-Class', 'GLA', 'GLC', 'GLE', 'GLS', 'CLA', 'ML-Class'],
      BMW: ['3 Series', '5 Series', '7 Series', '1 Series', 'X1', 'X3', 'X5', 'X6', 'X7'],
      Volkswagen: ['Golf', 'Polo', 'Passat', 'Jetta', 'Tiguan', 'Touareg', 'Beetle'],
      Ford: ['Fiesta', 'Focus', 'Fusion', 'Escape', 'Explorer', 'Edge', 'Everest', 'Mustang', 'EcoSport', 'Territory'],
      Subaru: ['Forester', 'Impreza', 'Legacy', 'Outback', 'XV', 'Crosstrek', 'WRX'],
      Isuzu: ['MU-X', 'Trooper'],
      'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Freelander'],
      Jeep: ['Wrangler', 'Cherokee', 'Grand Cherokee', 'Compass', 'Renegade'],
      Peugeot: ['206', '207', '208', '301', '307', '308', '407', '508', '2008', '3008', '5008'],
      Renault: ['Clio', 'Duster', 'Logan', 'Megane', 'Symbol', 'Kwid', 'Captur', 'Sandero', 'Koleos'],
      Chevrolet: ['Spark', 'Aveo', 'Cruze', 'Captiva', 'Optra', 'Malibu', 'Tahoe', 'Suburban', 'Camaro'],
      Daihatsu: ['Terios', 'Mira', 'Sirion', 'Rocky', 'Move'],
      Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7'],
      Volvo: ['S60', 'S90', 'XC40', 'XC60', 'XC90'],
      Skoda: ['Octavia', 'Fabia', 'Superb', 'Kodiaq'],
      BYD: ['Atto 3', 'Dolphin', 'Seal', 'Han', 'Tang', 'Song Plus', 'Qin Plus'],
      Jetour: ['X70', 'X90', 'Dashing', 'T2', 'X95'],
      Chery: ['Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'QQ', 'Omoda 5'],
      Geely: ['Emgrand', 'Coolray', 'Atlas', 'Monjaro', 'Geometry C'],
      Haval: ['H6', 'Jolion', 'H9', 'Dargo'],
      Changan: ['CS35', 'CS75', 'Alsvin'],
      Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X'],
    },
  },

  trucks: {
    popular: ['Isuzu', 'Toyota', 'Hino', 'Mitsubishi Fuso', 'Nissan', 'Mercedes-Benz', 'Scania', 'Volvo'],
    models: {
      Isuzu: ['NPR', 'NKR', 'FRR', 'FVR', 'FTR', 'Giga', 'D-Max', 'Elf'],
      Toyota: ['Hilux', 'Dyna', 'Land Cruiser Pickup', 'Hiace Van'],
      Hino: ['300', '500', '700', 'Ranger', 'Dutro'],
      'Mitsubishi Fuso': ['Canter', 'Fighter', 'Super Great'],
      Nissan: ['Navara', 'UD', 'Cabstar', 'Condor'],
      'Mercedes-Benz': ['Actros', 'Atego', 'Axor', 'Sprinter'],
      Scania: ['R-Series', 'G-Series', 'P-Series'],
      Volvo: ['FH', 'FM', 'FMX'],
      MAN: ['TGS', 'TGX', 'TGA'],
      Iveco: ['Daily', 'Eurocargo', 'Stralis', 'Trakker'],
      Ford: ['Ranger', 'Cargo', 'F-150'],
      Mitsubishi: ['L200'],
      Mazda: ['BT-50'],
      Tata: ['LPT 709', 'LPT 1613', 'Ultra', 'Prima', 'Xenon'],
      'Ashok Leyland': ['Boss', 'Ecomet', 'Captain'],
      Sinotruk: ['HOWO', 'Sitrak'],
      Shacman: ['F3000', 'X3000'],
      FAW: ['J6', 'CA1041', 'Tiger V'],
      Foton: ['Aumark', 'Auman', 'Tunland'],
      JAC: ['HFC1040', 'X200', 'T6'],
      Dongfeng: ['Captain', 'Duolika', 'Rich'],
      Volkswagen: ['Amarok', 'Crafter'],
    },
  },

  buses: {
    popular: ['Toyota', 'Nissan', 'Hyundai', 'Isuzu', 'Mitsubishi', 'Mercedes-Benz', 'Yutong'],
    models: {
      Toyota: ['Hiace', 'Coaster', 'Quantum'],
      Nissan: ['Urvan', 'Civilian', 'Caravan'],
      Hyundai: ['County', 'H-1', 'Universe', 'Aero'],
      Isuzu: ['Journey', 'Elf Micro Bus', 'Gala'],
      Mitsubishi: ['Rosa', 'L300'],
      'Mercedes-Benz': ['Sprinter', 'Tourismo', 'Travego'],
      Yutong: ['ZK6', 'ZK6122H9', 'ZK6118'],
      'King Long': ['XMQ6127', 'XMQ6900'],
      Higer: ['KLQ6129', 'KLQ6109'],
      'Golden Dragon': ['XML6122', 'XML6102'],
      Iveco: ['Daily', 'Crossway'],
      Scania: ['Touring', 'K-Series'],
      Volvo: ['9700', 'B9R'],
      Tata: ['Starbus', 'Marcopolo'],
      'Ashok Leyland': ['Viking', 'Lynx'],
    },
  },

  motorcycles: {
    popular: ['Bajaj', 'TVS', 'Honda', 'Yamaha', 'Suzuki', 'Haojue', 'Hero'],
    models: {
      Bajaj: ['Boxer', 'Pulsar', 'Discover', 'Platina', 'CT100', 'Dominar', 'Avenger', 'Pulsar NS200', 'Pulsar 150'],
      TVS: ['Apache', 'HLX', 'Star City', 'Jupiter', 'Raider', 'Sport', 'NTorq'],
      Honda: ['CG 125', 'CB', 'Wave', 'Dio', 'Activa', 'CBR', 'XR', 'PCX', 'Africa Twin'],
      Yamaha: ['YBR', 'Crux', 'FZ', 'NMax', 'Aerox', 'R15', 'MT-07', 'XTZ'],
      Suzuki: ['GN125', 'Gixxer', 'Address', 'GSX', 'V-Strom', 'Burgman'],
      Haojue: ['HJ125', 'Express', 'Lucky Star'],
      Hero: ['Splendor', 'HF Deluxe', 'Passion', 'Glamour', 'Xtreme'],
      Kawasaki: ['Ninja', 'Z', 'Versys', 'KLX'],
      'Royal Enfield': ['Classic 350', 'Bullet', 'Himalayan', 'Meteor'],
      KTM: ['Duke', 'RC', 'Adventure'],
      Piaggio: ['Liberty', 'Medley', 'Beverly'],
      Vespa: ['Primavera', 'Sprint', 'GTS'],
      Lifan: ['LF125', 'KPR'],
    },
  },

  // Three-wheelers (Bajaj-style passenger and cargo vehicles) are a different product from two-wheel motorcycles.
  threeWheelers: {
    popular: ['Bajaj', 'TVS', 'Piaggio', 'Mahindra'],
    models: {
      Bajaj: ['RE', 'Maxima Cargo', 'Maxima C', 'Qute', 'Compact 4S'],
      TVS: ['King', 'King Duramax', 'King Deluxe'],
      Piaggio: ['Ape', 'Ape City', 'Ape Xtra'],
      Mahindra: ['Treo', 'Alfa', 'Jeeto'],
      Atul: ['Gem', 'Shakti'],
    },
  },

  phones: {
    popular: ['Apple', 'Samsung', 'Tecno', 'Infinix', 'Xiaomi', 'Itel', 'Oppo', 'Huawei', 'Vivo', 'Realme', 'Nokia'],
    models: {
      Apple: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air', 'iPhone 17', 'iPhone 16e', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15', 'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14', 'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13 mini', 'iPhone 13', 'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12 mini', 'iPhone 12', 'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone SE (3rd generation)', 'iPhone SE (2nd generation)', 'iPhone XS Max', 'iPhone XS', 'iPhone XR', 'iPhone X', 'iPhone 8 Plus', 'iPhone 8', 'iPhone 7 Plus', 'iPhone 7'],
      Samsung: ['Galaxy S26 Ultra', 'Galaxy S26+', 'Galaxy S26', 'Galaxy Z Flip7 FE', 'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25 Edge', 'Galaxy S25', 'Galaxy S25 FE', 'Galaxy Z Fold7', 'Galaxy Z Flip7', 'Galaxy A56', 'Galaxy A36', 'Galaxy A26', 'Galaxy A16', 'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy S23', 'Galaxy S22 Ultra', 'Galaxy S21', 'Galaxy Z Fold5', 'Galaxy Z Flip5', 'Galaxy A55', 'Galaxy A54', 'Galaxy A35', 'Galaxy A34', 'Galaxy A25', 'Galaxy A15', 'Galaxy A14', 'Galaxy A05', 'Galaxy A05s', 'Galaxy A04', 'Galaxy A04s', 'Galaxy A03', 'Galaxy M14', 'Galaxy Note 20 Ultra', 'Galaxy Note 10'],
      Tecno: ['Spark 40 Pro', 'Spark 40', 'Spark 30 Pro', 'Spark 30', 'Camon 40 Pro', 'Camon 40', 'Pova 7', 'Pova 6 Pro', 'Spark 20', 'Spark 20 Pro', 'Spark 10', 'Spark 10 Pro', 'Spark Go', 'Camon 30', 'Camon 20', 'Camon 19', 'Pova 5', 'Pova 6', 'Phantom X2', 'Phantom V Fold', 'Pop 8', 'Pop 7'],
      Infinix: ['Hot 60i', 'Hot 60', 'Hot 50', 'Note 50', 'Note 50 Pro', 'Note 40 Pro', 'Zero 40', 'Smart 10', 'Smart 9', 'Hot 40', 'Hot 40i', 'Hot 30', 'Hot 20', 'Note 40', 'Note 30', 'Note 12', 'Zero 30', 'Zero 20', 'Smart 8', 'Smart 7', 'Smart 6'],
      Xiaomi: ['Xiaomi 15T Pro', 'Xiaomi 15T', 'Xiaomi 15 Ultra', 'Xiaomi 15', 'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 14', 'Redmi 14C', 'Redmi A5', 'Poco F7', 'Poco X7 Pro', 'Poco X7', 'Redmi Note 13 Pro', 'Redmi Note 13', 'Redmi Note 12', 'Redmi Note 11', 'Redmi 13C', 'Redmi 12', 'Redmi 12C', 'Redmi A3', 'Redmi A2', 'Poco X6 Pro', 'Poco X6', 'Poco M6', 'Poco F5', 'Xiaomi 14', 'Xiaomi 13T'],
      Itel: ['A70', 'A60', 'A58', 'P55', 'P40', 'S23', 'Vision 5', 'Vision 3'],
      Oppo: ['Reno 14', 'Reno 13', 'A5', 'Reno 11', 'Reno 10', 'Reno 8', 'A78', 'A58', 'A38', 'A18', 'A17', 'Find X5'],
      Huawei: ['Nova 11', 'Nova 10', 'Nova Y91', 'Nova Y70', 'P60 Pro', 'P50', 'P40', 'Mate 60 Pro', 'Y9s'],
      Vivo: ['V60', 'V50', 'V40', 'Y29', 'V29', 'V27', 'V25', 'Y36', 'Y27', 'Y17s', 'Y03', 'X90', 'X100'],
      Realme: ['C67', 'C55', 'C53', 'C51', 'C35', 'Note 50', '11 Pro', '11', '10', 'GT 5'],
      Nokia: ['G42', 'G22', 'C32', 'C22', 'C21', 'X30', '105', '110'],
      Google: ['Pixel 10 Pro XL', 'Pixel 10 Pro', 'Pixel 10', 'Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 9a', 'Pixel 8 Pro', 'Pixel 8', 'Pixel 7', 'Pixel 6a', 'Pixel 6'],
      OnePlus: ['13', '12', '11', 'Nord CE 3', 'Nord N30'],
      Motorola: ['Moto G84', 'Moto G54', 'Moto G24', 'Edge 40'],
    },
  },

  laptops: {
    popular: ['HP', 'Dell', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Samsung', 'Microsoft'],
    models: {
      // Apple: the chip is part of the name so a buyer sees exactly which generation it is. Newest first.
      Apple: [
        'MacBook Pro 14" M6', 'MacBook Pro 14" M5', 'MacBook Pro 14" M5 Pro', 'MacBook Pro 14" M5 Max', 'MacBook Pro 16" M5 Pro', 'MacBook Pro 16" M5 Max',
        'MacBook Air 15" M5', 'MacBook Air 13" M5', 'MacBook Neo',
        'MacBook Pro 14" M4', 'MacBook Pro 14" M4 Pro', 'MacBook Pro 14" M4 Max', 'MacBook Pro 16" M4 Pro', 'MacBook Pro 16" M4 Max',
        'MacBook Air 15" M4', 'MacBook Air 13" M4',
        'MacBook Pro 14" M3', 'MacBook Pro 14" M3 Pro', 'MacBook Pro 14" M3 Max', 'MacBook Pro 16" M3 Pro', 'MacBook Pro 16" M3 Max',
        'MacBook Air 15" M3', 'MacBook Air 13" M3',
        'MacBook Pro 14" M2 Pro', 'MacBook Pro 14" M2 Max', 'MacBook Pro 16" M2 Pro', 'MacBook Pro 16" M2 Max', 'MacBook Pro 13" M2',
        'MacBook Air 15" M2', 'MacBook Air 13" M2',
        'MacBook Pro 14" M1 Pro', 'MacBook Pro 14" M1 Max', 'MacBook Pro 16" M1 Pro', 'MacBook Pro 16" M1 Max', 'MacBook Pro 13" M1', 'MacBook Air 13" M1',
        'MacBook Pro 16" (Intel)', 'MacBook Pro 15" (Intel)', 'MacBook Pro 13" (Intel)', 'MacBook Air 13" (Intel)', 'MacBook 12" (Intel)',
      ],
      HP: ['OmniBook X', 'OmniBook Ultra', 'OmniBook 5', 'OmniBook 3', 'EliteBook', 'EliteBook Ultra', 'ProBook', 'Pavilion', 'Pavilion Plus', 'Pavilion Aero', 'Envy', 'Spectre', 'ZBook', 'Omen', 'Victus', 'Dragonfly', 'Chromebook', '250 G10', '250 G9', '250 G8', '255 G10', '255 G9', '255 G8', '14s', '15s', 'HP 14', 'HP 15', 'HP 17'],
      Dell: ['Dell Pro', 'Dell Pro Plus', 'Dell Pro Max', 'Dell 14', 'Dell 15', 'Dell 16', 'Latitude', 'Inspiron', 'XPS 13', 'XPS 14', 'XPS 15', 'XPS 16', 'XPS 17', 'Vostro', 'Precision', 'Alienware', 'G15', 'G16', 'Chromebook'],
      Lenovo: ['ThinkPad X1 Carbon', 'ThinkPad X1 Yoga', 'ThinkPad X1 Nano', 'ThinkPad T14', 'ThinkPad T14s', 'ThinkPad T16', 'ThinkPad X13', 'ThinkPad E14', 'ThinkPad E15', 'ThinkPad E16', 'ThinkPad L14', 'ThinkPad L15', 'ThinkPad P1', 'ThinkPad P14s', 'ThinkBook', 'IdeaPad Slim', 'IdeaPad Flex', 'IdeaPad Gaming', 'IdeaPad 1', 'IdeaPad 3', 'IdeaPad 5', 'Yoga Slim', 'Yoga Pro', 'Yoga 7', 'Yoga 9i', 'Legion 5', 'Legion 7', 'Legion Pro', 'Legion Slim', 'LOQ', 'V14', 'V15', 'Chromebook'],
      Asus: ['Vivobook', 'Vivobook S', 'Vivobook Go', 'Zenbook', 'Zenbook S', 'Zenbook Duo', 'ROG Strix', 'ROG Zephyrus', 'ROG Flow', 'TUF Gaming', 'ExpertBook', 'ProArt', 'Chromebook'],
      Acer: ['Aspire 3', 'Aspire 5', 'Aspire 7', 'Aspire Go', 'Swift Go', 'Swift Edge', 'Swift X', 'Nitro V', 'Nitro 5', 'Predator Helios', 'Predator Triton', 'TravelMate', 'Spin', 'Chromebook'],
      Microsoft: ['Surface Laptop 7', 'Surface Laptop 6', 'Surface Laptop 5', 'Surface Laptop Go 3', 'Surface Laptop Studio 2', 'Surface Pro 11', 'Surface Pro 10', 'Surface Pro 9', 'Surface Pro 8', 'Surface Book 3'],
      MSI: ['Katana', 'Cyborg', 'Thin', 'Stealth', 'Raider', 'Vector', 'Titan', 'Modern', 'Prestige', 'Summit', 'Creator'],
      Samsung: ['Galaxy Book5 Pro', 'Galaxy Book5 Pro 360', 'Galaxy Book4 Ultra', 'Galaxy Book4 Pro', 'Galaxy Book4', 'Galaxy Book3', 'Galaxy Book2', 'Galaxy Chromebook'],
      Huawei: ['MateBook X Pro', 'MateBook 14', 'MateBook 16s', 'MateBook D 14', 'MateBook D 15', 'MateBook D 16'],
      Toshiba: ['Satellite', 'Tecra', 'Portege'],
      Razer: ['Blade 14', 'Blade 16', 'Blade 18', 'Blade 15'],
      LG: ['gram 14', 'gram 16', 'gram 17', 'gram Pro'],
      Xiaomi: ['RedmiBook Pro', 'RedmiBook 15', 'Xiaomi Book'],
      Honor: ['MagicBook 14', 'MagicBook X16'],
      Gigabyte: ['Aero', 'Aorus', 'G5'],
      Infinix: ['INBook Y1 Plus', 'INBook X2', 'INBook X1'],
      Tecno: ['Megabook T1', 'Megabook K15S'],
      Chuwi: ['HeroBook', 'GemiBook', 'CoreBook'],
      Google: ['Pixelbook'],
    },
  },

  tablets: {
    popular: ['Apple', 'Samsung', 'Huawei', 'Lenovo', 'Xiaomi'],
    models: {
      Apple: [
        'iPad Pro 13" (M5)', 'iPad Pro 11" (M5)', 'iPad Air 13" (M4)', 'iPad Air 11" (M4)', 'iPad (A16)', 'iPad mini (A17 Pro)',
        'iPad Pro 13" (M4)', 'iPad Pro 11" (M4)', 'iPad Air 13" (M3)', 'iPad Air 11" (M3)', 'iPad Air 13" (M2)', 'iPad Air 11" (M2)',
        'iPad Pro 12.9" (6th generation)', 'iPad Pro 11" (4th generation)', 'iPad Pro 12.9" (5th generation)', 'iPad Pro 11" (3rd generation)',
        'iPad Air (5th generation)', 'iPad Air (4th generation)', 'iPad (10th generation)', 'iPad (9th generation)', 'iPad (8th generation)', 'iPad mini (6th generation)',
      ],
      Samsung: ['Galaxy Tab S11 Ultra', 'Galaxy Tab S11', 'Galaxy Tab S10 Ultra', 'Galaxy Tab S10+', 'Galaxy Tab S10 FE+', 'Galaxy Tab S10 FE', 'Galaxy Tab S9 Ultra', 'Galaxy Tab S9+', 'Galaxy Tab S9 FE+', 'Galaxy Tab S9 FE', 'Galaxy Tab S9', 'Galaxy Tab S8 Ultra', 'Galaxy Tab S8+', 'Galaxy Tab S8', 'Galaxy Tab S7 FE', 'Galaxy Tab S6 Lite', 'Galaxy Tab A9+', 'Galaxy Tab A9', 'Galaxy Tab A8', 'Galaxy Tab A7 Lite', 'Galaxy Tab A7', 'Galaxy Tab Active5'],
      Huawei: ['MatePad Pro 13.2"', 'MatePad Pro 12.2"', 'MatePad Pro 11"', 'MatePad 11.5"', 'MatePad 11', 'MatePad SE 11"', 'MatePad Air', 'MatePad T10s', 'MatePad T10', 'MatePad Pro'],
      Lenovo: ['Tab P12', 'Tab P11 Pro Gen 2', 'Tab P11 (2nd Gen)', 'Tab P11', 'Tab M11', 'Tab M10 Plus', 'Tab M10', 'Tab M9', 'Tab M8', 'Tab K11'],
      Xiaomi: ['Pad 7 Pro', 'Pad 7', 'Pad 6S Pro', 'Pad 6 Pro', 'Pad 6', 'Pad 5', 'Redmi Pad 2', 'Redmi Pad Pro', 'Redmi Pad SE', 'Redmi Pad'],
      Amazon: ['Fire Max 11', 'Fire HD 10', 'Fire HD 8', 'Fire 7'],
      Honor: ['Pad X9', 'Pad 9'],
      Realme: ['Pad 2', 'Pad Mini'],
      OnePlus: ['Pad 3', 'Pad 2'],
      Infinix: ['XPAD'],
      Tecno: ['Megapad'],
      Google: ['Pixel Tablet'],
      Microsoft: ['Surface Pro 11', 'Surface Pro 10', 'Surface Go 4'],
    },
  },

  // TV model codes are long alphanumerics sellers copy from the back of the set: brand is picked, model stays free text.
  tvs: {
    popular: ['Samsung', 'LG', 'Hisense', 'TCL', 'Sony', 'Skyworth'],
    models: {
      Samsung: [], LG: [], Hisense: [], TCL: [], Sony: [], Skyworth: [], Toshiba: [], Philips: [], Panasonic: [], Sharp: [], Xiaomi: [], Haier: [], Vitron: [], Nasco: [],
    },
  },

  // Desktop computers: Apple's desktops carry the chip in the model name, like the laptops.
  desktops: {
    popular: ['HP', 'Dell', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Custom built'],
    models: {
      HP: ['EliteDesk', 'ProDesk', 'EliteOne', 'ProOne', 'Pavilion Desktop', 'Omen', 'Victus', 'Z Workstation', 'All-in-One 24', 'All-in-One 27'],
      Dell: ['OptiPlex', 'OptiPlex All-in-One', 'Precision Tower', 'XPS Desktop', 'Alienware Aurora', 'Vostro Desktop', 'Inspiron Desktop', 'Dell Pro Tower'],
      Lenovo: ['ThinkCentre', 'ThinkCentre Tiny', 'ThinkStation', 'IdeaCentre', 'IdeaCentre AIO', 'Legion Tower'],
      Apple: ['iMac 24" M4', 'iMac 24" M3', 'iMac 24" M1', 'iMac 27" (Intel)', 'iMac 21.5" (Intel)', 'Mac mini M4 Pro', 'Mac mini M4', 'Mac mini M2 Pro', 'Mac mini M2', 'Mac mini M1', 'Mac mini (Intel)', 'Mac Studio M4 Max', 'Mac Studio M3 Ultra', 'Mac Studio M2 Ultra', 'Mac Studio M2 Max', 'Mac Studio M1 Ultra', 'Mac Studio M1 Max', 'Mac Pro M2 Ultra'],
      Asus: ['ROG Strix', 'ROG Strix GT', 'ExpertCenter', 'Vivo AiO', 'Zen AiO', 'Mini PC PN'],
      Acer: ['Aspire', 'Veriton', 'Predator Orion', 'Nitro', 'Chromebox'],
      MSI: ['MAG', 'MPG', 'Codex', 'Pro AiO', 'Cubi'],
      Intel: ['NUC'],
      Beelink: [],
      Minisforum: [],
      Gigabyte: ['Brix'],
      'Custom built': [],
    },
  },

  // Brand-only sets: the model is too varied to list, the brand is a pick-from-the-list choice.
  computerAccessories: {
    popular: ['Logitech', 'HP', 'Dell', 'Lenovo', 'Razer', 'Corsair', 'SanDisk', 'Samsung', 'Kingston', 'Anker', 'Generic / No brand'],
    models: Object.fromEntries(
      ['Logitech', 'HP', 'Dell', 'Lenovo', 'Apple', 'Microsoft', 'Asus', 'Acer', 'Razer', 'Corsair', 'HyperX', 'SteelSeries', 'Redragon', 'A4Tech', 'Rapoo', 'Havit', 'Fantech', 'Anker', 'Ugreen', 'Baseus', 'Samsung', 'Kingston', 'SanDisk', 'Western Digital', 'Seagate', 'Transcend', 'Lexar', 'LG', 'BenQ', 'ViewSonic', 'AOC', 'Epson', 'Wacom', 'Huion', 'APC', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  computerParts: {
    popular: ['Kingston', 'Samsung', 'Crucial', 'Western Digital', 'Seagate', 'Intel', 'AMD', 'NVIDIA', 'Generic / No brand'],
    models: Object.fromEntries(
      ['Intel', 'AMD', 'NVIDIA', 'Asus', 'MSI', 'Gigabyte', 'Corsair', 'Kingston', 'Crucial', 'Samsung', 'SK hynix', 'Micron', 'Western Digital', 'Seagate', 'SanDisk', 'Toshiba', 'Cooler Master', 'Thermaltake', 'Deepcool', 'HP', 'Dell', 'Lenovo', 'Apple', 'Acer', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  audio: {
    popular: ['JBL', 'Sony', 'Samsung', 'Apple', 'Anker', 'Shure', 'Rode', 'Boya', 'Generic / No brand'],
    models: Object.fromEntries(
      ['JBL', 'Sony', 'Bose', 'Samsung', 'Apple', 'Anker', 'Logitech', 'Sennheiser', 'Shure', 'Rode', 'Audio-Technica', 'Beats', 'Xiaomi', 'Oraimo', 'Huawei', 'Harman Kardon', 'Yamaha', 'Behringer', 'Boya', 'Hollyland', 'Fifine', 'Razer', 'HyperX', 'Marshall', 'Skullcandy', 'Philips', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  speakers: {
    popular: ['JBL', 'Sony', 'Anker', 'Samsung', 'LG', 'Xiaomi', 'Oraimo', 'Generic / No brand'],
    models: Object.fromEntries(
      ['JBL', 'Sony', 'Bose', 'Anker', 'Harman Kardon', 'Marshall', 'Ultimate Ears', 'Samsung', 'LG', 'Xiaomi', 'Oraimo', 'Huawei', 'Apple', 'Sonos', 'Yamaha', 'Philips', 'Hisense', 'TCL', 'Vitron', 'Nasco', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  printers: {
    popular: ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Ricoh'],
    models: Object.fromEntries(
      ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Ricoh', 'Kyocera', 'Konica Minolta', 'Lexmark', 'Sharp', 'Pantum', 'Zebra', 'Xprinter', 'Creality', 'Bambu Lab', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  networking: {
    popular: ['TP-Link', 'Huawei', 'Starlink', 'Hikvision', 'Dahua', 'Tenda', 'D-Link', 'Xiaomi'],
    models: Object.fromEntries(
      ['TP-Link', 'Huawei', 'Tenda', 'D-Link', 'Netgear', 'Ubiquiti', 'MikroTik', 'Cisco', 'Asus', 'Xiaomi', 'ZTE', 'Starlink', 'Hikvision', 'Dahua', 'EZVIZ', 'Imou', 'Reolink', 'Uniview', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
  cameras: {
    popular: ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'GoPro', 'DJI', 'Panasonic'],
    models: {
      Canon: ['EOS R5 Mark II', 'EOS R5', 'EOS R6 Mark II', 'EOS R6', 'EOS R7', 'EOS R8', 'EOS R10', 'EOS R50', 'EOS R100', 'EOS 5D Mark IV', 'EOS 6D Mark II', 'EOS 90D', 'EOS 80D', 'EOS 250D', 'EOS 850D', 'EOS 200D II', 'EOS 200D', 'EOS 1500D', 'EOS 2000D', 'EOS 4000D', 'EOS 1300D', 'PowerShot G7 X Mark III', 'PowerShot SX740'],
      Nikon: ['Z9', 'Z8', 'Z7 II', 'Z6 III', 'Z6 II', 'Z5 II', 'Z50 II', 'Z30', 'Zf', 'Zfc', 'D850', 'D780', 'D750', 'D7500', 'D7200', 'D5600', 'D3500', 'D3400', 'D3200'],
      Sony: ['Alpha 1 II', 'A9 III', 'A7R V', 'A7 IV', 'A7 III', 'A7C II', 'A7C', 'A7S III', 'A6700', 'A6400', 'A6100', 'A6000', 'ZV-E10 II', 'ZV-E10', 'ZV-1 II', 'ZV-1', 'FX3', 'FX30', 'RX100 VII'],
      Fujifilm: ['X-T5', 'X-T50', 'X-S20', 'X-H2S', 'X-H2', 'X100VI', 'X-E4', 'GFX100 II', 'Instax Mini 12', 'Instax Mini 11'],
      GoPro: ['HERO13 Black', 'HERO12 Black', 'HERO11 Black', 'HERO10 Black', 'HERO9 Black', 'HERO8 Black', 'MAX'],
      DJI: ['Osmo Action 5 Pro', 'Osmo Action 4', 'Osmo Pocket 3', 'Mini 4 Pro', 'Mini 4K', 'Mini 3 Pro', 'Mini 3', 'Mini 2 SE', 'Air 3S', 'Air 3', 'Mavic 3 Pro', 'Mavic 3 Classic', 'Avata 2', 'Neo'],
      Panasonic: ['Lumix S5 II', 'Lumix GH7', 'Lumix GH6', 'Lumix G9 II', 'Lumix G100', 'Lumix S1H'],
      Insta360: ['X5', 'X4', 'Ace Pro 2', 'GO 3S'],
      'OM System': ['OM-1 Mark II', 'OM-5'],
      Olympus: ['OM-D E-M10 Mark IV', 'OM-D E-M5 Mark III', 'PEN E-PL10'],
      Leica: ['Q3', 'M11', 'D-Lux 8'],
      Kodak: ['PIXPRO FZ55'],
    },
  },
  bicycles: {
    popular: ['Giant', 'Trek', 'Specialized', 'Merida', 'Decathlon', 'Hero'],
    models: Object.fromEntries(
      ['Giant', 'Trek', 'Specialized', 'Scott', 'Cannondale', 'Merida', 'Bianchi', 'Cube', 'Decathlon', 'Raleigh', 'Hero', 'Phoenix', 'Avon', 'Atlas', 'Bergamont', 'Xiaomi', 'Generic / No brand'].map((b) => [b, [] as string[]])
    ),
  },
};

/** Which catalog set serves which category/subcategory scope (same scope keys as categoryFields). */
export const CATALOG_SCOPES: Record<string, string> = {
  'vehicles/Cars': 'cars',
  'vehicles/SUVs': 'cars',
  'vehicles/Trucks': 'trucks',
  'vehicles/Buses': 'buses',
  'vehicles/Motorcycles': 'motorcycles',
  'vehicles/Bajaj': 'threeWheelers',
  phones: 'phones',
  'electronics/Laptops': 'laptops',
  'electronics/Desktop Computers': 'desktops',
  'electronics/Computer Accessories': 'computerAccessories',
  'electronics/Computer Parts': 'computerParts',
  'electronics/Cameras': 'cameras',
  'electronics/Speakers': 'speakers',
  'electronics/Audio & Microphones': 'audio',
  'electronics/Printers & Scanners': 'printers',
  'electronics/Networking & Security': 'networking',
  'sports/Bicycles': 'bicycles',
  'electronics/Tablets': 'tablets',
  'electronics/TVs': 'tvs',
};

/** A picker field's link to its catalog. `role: 'model'` fields list the models of whatever brand is chosen in the `brand` field. */
export type FieldCatalog = { set: string; role: 'brand' | 'model' };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

export function hasCatalog(set: string): boolean {
  return !!CATALOGS[set];
}

/** `common` = the editorial seed brands that exist in the set; `all` = every brand A–Z. */
export function catalogBrands(set: string): { common: string[]; all: string[] } {
  const c = CATALOGS[set];
  if (!c) return { common: [], all: [] };
  const all = Object.keys(c.models).sort(byName);
  return { common: c.popular.filter((b) => b in c.models), all };
}

/** The catalog's spelling of a brand (case/space-insensitive), or undefined when the brand isn't in the catalog (typed by hand, or saved long ago). */
export function canonicalBrand(set: string, brand: string | undefined): string | undefined {
  const c = CATALOGS[set];
  if (!c || !brand) return undefined;
  const n = norm(brand);
  return Object.keys(c.models).find((b) => norm(b) === n);
}

/**
 * Models of one brand: `common` = the first few in seed order, `all` = A–Z.
 * undefined when the brand is unknown or has no model list — the model field then stays plain text.
 */
export function catalogModels(set: string, brand: string | undefined): { common: string[]; all: string[] } | undefined {
  const c = CATALOGS[set];
  const key = canonicalBrand(set, brand);
  if (!c || !key) return undefined;
  const models = c.models[key];
  if (!models.length) return undefined;
  return { common: models.length > 12 ? models.slice(0, 8) : [], all: [...models].sort(byName) };
}

/** Case-insensitive search: names that START with the query come first, then names that contain it. */
export function searchCatalog(list: string[], query: string): string[] {
  const q = norm(query);
  if (!q) return list;
  const starts: string[] = [];
  const contains: string[] = [];
  for (const item of list) {
    const n = norm(item);
    if (n.startsWith(q)) starts.push(item);
    else if (n.includes(q)) contains.push(item);
  }
  return [...starts, ...contains];
}

type CatalogField = { key: string; catalog?: FieldCatalog };

/**
 * Keys to blank when `changed` gets a new value: choosing a different brand empties the model, because the old
 * model belongs to the old brand. Changing nothing (or re-picking the same brand) clears nothing.
 */
export function dependentKeysToClear(fields: CatalogField[], changed: CatalogField, oldValue: string | undefined, newValue: string): string[] {
  if (changed.catalog?.role !== 'brand') return [];
  if (norm(oldValue ?? '') === norm(newValue)) return [];
  const set = changed.catalog.set;
  return fields.filter((f) => f.catalog?.role === 'model' && f.catalog.set === set).map((f) => f.key);
}
