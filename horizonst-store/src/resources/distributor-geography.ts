export type DistributorProvince = { code: string; name: string };
export type DistributorRegion = { code: string; name: string; provinces: DistributorProvince[] };
export type DistributorCountry = {
  code: string; name: string; regionLabel: string; provinceLabel: string;
  regionRequired: boolean; provinceRequired: boolean;
  postalCodeExample: string; postalCodePattern: RegExp;
  taxIdExample: string; taxIdPattern?: RegExp;
  regions: DistributorRegion[];
};

const subdivisions = (names: string[]): DistributorProvince[] => names.map((name, index) => ({ code: String(index + 1).padStart(2, '0'), name }));
const simpleRegions = (names: string[]): DistributorRegion[] => names.map((name, index) => ({ code: String(index + 1).padStart(2, '0'), name, provinces: [] }));
const genericPostalCodePattern = /^[A-Z0-9][A-Z0-9 -]{2,11}$/i;
const genericTaxIdPattern = /^[A-Z0-9][A-Z0-9 .\/-]{2,39}$/i;
const europeanCountry = (input: Pick<DistributorCountry, 'code' | 'name'> & Partial<DistributorCountry>): DistributorCountry => ({
  regionLabel: 'Región / área administrativa', provinceLabel: 'Provincia / división administrativa',
  regionRequired: false, provinceRequired: false,
  postalCodeExample: 'Código postal local', postalCodePattern: genericPostalCodePattern,
  taxIdExample: 'VAT / Tax ID', taxIdPattern: genericTaxIdPattern, regions: [], ...input
});

const spain: DistributorCountry = europeanCountry({
  code: 'ES',
  name: 'España',
  regionLabel: 'Comunidad Autónoma', provinceLabel: 'Provincia', regionRequired: true, provinceRequired: true,
  postalCodeExample: '30001', postalCodePattern: /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/,
  taxIdExample: 'B12345678', taxIdPattern: /^(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/i,
  regions: [
    { code: 'AN', name: 'Andalucía', provinces: ['Almería', 'Cádiz', 'Córdoba', 'Granada', 'Huelva', 'Jaén', 'Málaga', 'Sevilla'].map((name, index) => ({ code: ['AL', 'CA', 'CO', 'GR', 'HU', 'JA', 'MA', 'SE'][index], name })) },
    { code: 'AR', name: 'Aragón', provinces: [{ code: 'HU', name: 'Huesca' }, { code: 'TE', name: 'Teruel' }, { code: 'ZG', name: 'Zaragoza' }] },
    { code: 'AS', name: 'Principado de Asturias', provinces: [{ code: 'O', name: 'Asturias' }] },
    { code: 'IB', name: 'Illes Balears', provinces: [{ code: 'PM', name: 'Illes Balears' }] },
    { code: 'CN', name: 'Canarias', provinces: [{ code: 'GC', name: 'Las Palmas' }, { code: 'TF', name: 'Santa Cruz de Tenerife' }] },
    { code: 'CB', name: 'Cantabria', provinces: [{ code: 'S', name: 'Cantabria' }] },
    { code: 'CM', name: 'Castilla-La Mancha', provinces: ['Albacete', 'Ciudad Real', 'Cuenca', 'Guadalajara', 'Toledo'].map((name, index) => ({ code: ['AB', 'CR', 'CU', 'GU', 'TO'][index], name })) },
    { code: 'CL', name: 'Castilla y León', provinces: ['Ávila', 'Burgos', 'León', 'Palencia', 'Salamanca', 'Segovia', 'Soria', 'Valladolid', 'Zamora'].map((name, index) => ({ code: ['AV', 'BU', 'LE', 'P', 'SA', 'SG', 'SO', 'VA', 'ZA'][index], name })) },
    { code: 'CT', name: 'Cataluña', provinces: [{ code: 'B', name: 'Barcelona' }, { code: 'GI', name: 'Girona' }, { code: 'L', name: 'Lleida' }, { code: 'T', name: 'Tarragona' }] },
    { code: 'VC', name: 'Comunitat Valenciana', provinces: [{ code: 'A', name: 'Alicante' }, { code: 'CS', name: 'Castellón' }, { code: 'V', name: 'Valencia' }] },
    { code: 'EX', name: 'Extremadura', provinces: [{ code: 'BA', name: 'Badajoz' }, { code: 'CC', name: 'Cáceres' }] },
    { code: 'GA', name: 'Galicia', provinces: [{ code: 'C', name: 'A Coruña' }, { code: 'LU', name: 'Lugo' }, { code: 'OR', name: 'Ourense' }, { code: 'PO', name: 'Pontevedra' }] },
    { code: 'MD', name: 'Comunidad de Madrid', provinces: [{ code: 'M', name: 'Madrid' }] },
    { code: 'MC', name: 'Región de Murcia', provinces: [{ code: 'MU', name: 'Murcia' }] },
    { code: 'NC', name: 'Comunidad Foral de Navarra', provinces: [{ code: 'NA', name: 'Navarra' }] },
    { code: 'PV', name: 'País Vasco', provinces: [{ code: 'VI', name: 'Álava' }, { code: 'BI', name: 'Bizkaia' }, { code: 'SS', name: 'Gipuzkoa' }] },
    { code: 'RI', name: 'La Rioja', provinces: [{ code: 'LO', name: 'La Rioja' }] },
    { code: 'CE', name: 'Ceuta', provinces: [{ code: 'CE', name: 'Ceuta' }] },
    { code: 'ML', name: 'Melilla', provinces: [{ code: 'ML', name: 'Melilla' }] }
  ]
});

const unitedKingdom = europeanCountry({
  code: 'GB', name: 'Reino Unido', regionLabel: 'Nación / Región', provinceLabel: 'Condado / área administrativa', regionRequired: true, provinceRequired: true,
  postalCodeExample: 'SW1A 1AA', postalCodePattern: /^(?:GIR ?0AA|(?:[A-PR-UWYZ][0-9][0-9A-HJKSTUW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRV-Y]?) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i,
  taxIdExample: 'GB123456789', taxIdPattern: /^(?:(?:GB)?(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})|[A-Z]{2}\d{6}|\d{8})$/i,
  regions: [
    { code: 'ENG', name: 'England', provinces: subdivisions(['Bedfordshire', 'Berkshire', 'Bristol', 'Buckinghamshire', 'Cambridgeshire', 'Cheshire', 'City of London', 'Cornwall', 'Cumbria', 'Derbyshire', 'Devon', 'Dorset', 'Durham', 'East Riding of Yorkshire', 'East Sussex', 'Essex', 'Gloucestershire', 'Greater London', 'Greater Manchester', 'Hampshire', 'Herefordshire', 'Hertfordshire', 'Isle of Wight', 'Kent', 'Lancashire', 'Leicestershire', 'Lincolnshire', 'Merseyside', 'Norfolk', 'North Yorkshire', 'Northamptonshire', 'Northumberland', 'Nottinghamshire', 'Oxfordshire', 'Rutland', 'Shropshire', 'Somerset', 'South Yorkshire', 'Staffordshire', 'Suffolk', 'Surrey', 'Tyne and Wear', 'Warwickshire', 'West Midlands', 'West Sussex', 'West Yorkshire', 'Wiltshire', 'Worcestershire']) },
    { code: 'SCT', name: 'Scotland', provinces: subdivisions(['Aberdeen City', 'Aberdeenshire', 'Angus', 'Argyll and Bute', 'City of Edinburgh', 'Clackmannanshire', 'Dumfries and Galloway', 'Dundee City', 'East Ayrshire', 'East Dunbartonshire', 'East Lothian', 'East Renfrewshire', 'Falkirk', 'Fife', 'Glasgow City', 'Highland', 'Inverclyde', 'Midlothian', 'Moray', 'Na h-Eileanan Siar', 'North Ayrshire', 'North Lanarkshire', 'Orkney Islands', 'Perth and Kinross', 'Renfrewshire', 'Scottish Borders', 'Shetland Islands', 'South Ayrshire', 'South Lanarkshire', 'Stirling', 'West Dunbartonshire', 'West Lothian']) },
    { code: 'WLS', name: 'Wales', provinces: subdivisions(['Blaenau Gwent', 'Bridgend', 'Caerphilly', 'Cardiff', 'Carmarthenshire', 'Ceredigion', 'Conwy', 'Denbighshire', 'Flintshire', 'Gwynedd', 'Isle of Anglesey', 'Merthyr Tydfil', 'Monmouthshire', 'Neath Port Talbot', 'Newport', 'Pembrokeshire', 'Powys', 'Rhondda Cynon Taf', 'Swansea', 'Torfaen', 'Vale of Glamorgan', 'Wrexham']) },
    { code: 'NIR', name: 'Northern Ireland', provinces: subdivisions(['Antrim and Newtownabbey', 'Ards and North Down', 'Armagh City, Banbridge and Craigavon', 'Belfast', 'Causeway Coast and Glens', 'Derry City and Strabane', 'Fermanagh and Omagh', 'Lisburn and Castlereagh', 'Mid and East Antrim', 'Mid Ulster', 'Newry, Mourne and Down']) }
  ]
});

const france = europeanCountry({
  code: 'FR', name: 'Francia', regionLabel: 'Región', provinceLabel: 'Departamento', regionRequired: true, provinceRequired: true,
  postalCodeExample: '75001', postalCodePattern: /^\d{5}$/, taxIdExample: 'FR12345678901', taxIdPattern: /^(?:FR)?[0-9A-Z]{2}\d{9}$/i,
  regions: [
    { code: 'ARA', name: 'Auvergne-Rhône-Alpes', provinces: subdivisions(['Ain', 'Allier', 'Ardèche', 'Cantal', 'Drôme', 'Haute-Loire', 'Haute-Savoie', 'Isère', 'Loire', 'Puy-de-Dôme', 'Rhône', 'Savoie']) },
    { code: 'BFC', name: 'Bourgogne-Franche-Comté', provinces: subdivisions(['Côte-d’Or', 'Doubs', 'Haute-Saône', 'Jura', 'Nièvre', 'Saône-et-Loire', 'Territoire de Belfort', 'Yonne']) },
    { code: 'BRE', name: 'Bretagne', provinces: subdivisions(['Côtes-d’Armor', 'Finistère', 'Ille-et-Vilaine', 'Morbihan']) },
    { code: 'CVL', name: 'Centre-Val de Loire', provinces: subdivisions(['Cher', 'Eure-et-Loir', 'Indre', 'Indre-et-Loire', 'Loir-et-Cher', 'Loiret']) },
    { code: 'COR', name: 'Corse', provinces: subdivisions(['Corse-du-Sud', 'Haute-Corse']) },
    { code: 'GES', name: 'Grand Est', provinces: subdivisions(['Ardennes', 'Aube', 'Bas-Rhin', 'Haute-Marne', 'Haut-Rhin', 'Marne', 'Meurthe-et-Moselle', 'Meuse', 'Moselle', 'Vosges']) },
    { code: 'HDF', name: 'Hauts-de-France', provinces: subdivisions(['Aisne', 'Nord', 'Oise', 'Pas-de-Calais', 'Somme']) },
    { code: 'IDF', name: 'Île-de-France', provinces: subdivisions(['Essonne', 'Hauts-de-Seine', 'Paris', 'Seine-et-Marne', 'Seine-Saint-Denis', 'Val-de-Marne', 'Val-d’Oise', 'Yvelines']) },
    { code: 'NOR', name: 'Normandie', provinces: subdivisions(['Calvados', 'Eure', 'Manche', 'Orne', 'Seine-Maritime']) },
    { code: 'NAQ', name: 'Nouvelle-Aquitaine', provinces: subdivisions(['Charente', 'Charente-Maritime', 'Corrèze', 'Creuse', 'Deux-Sèvres', 'Dordogne', 'Gironde', 'Haute-Vienne', 'Landes', 'Lot-et-Garonne', 'Pyrénées-Atlantiques', 'Vienne']) },
    { code: 'OCC', name: 'Occitanie', provinces: subdivisions(['Ariège', 'Aude', 'Aveyron', 'Gard', 'Gers', 'Haute-Garonne', 'Hautes-Pyrénées', 'Hérault', 'Lot', 'Lozère', 'Pyrénées-Orientales', 'Tarn', 'Tarn-et-Garonne']) },
    { code: 'PDL', name: 'Pays de la Loire', provinces: subdivisions(['Loire-Atlantique', 'Maine-et-Loire', 'Mayenne', 'Sarthe', 'Vendée']) },
    { code: 'PAC', name: 'Provence-Alpes-Côte d’Azur', provinces: subdivisions(['Alpes-de-Haute-Provence', 'Alpes-Maritimes', 'Bouches-du-Rhône', 'Hautes-Alpes', 'Var', 'Vaucluse']) }
  ]
});

const withRegions = (code: string, name: string, regionLabel: string, postalCodeExample: string, postalCodePattern: RegExp, names: string[]) => europeanCountry({ code, name, regionLabel, regionRequired: true, postalCodeExample, postalCodePattern, regions: simpleRegions(names) });

export const distributorCountries: DistributorCountry[] = [
  unitedKingdom, spain, france,
  withRegions('DE', 'Alemania', 'Estado federado', '10115', /^\d{5}$/, ['Baden-Württemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hesse', 'Lower Saxony', 'Mecklenburg-Vorpommern', 'North Rhine-Westphalia', 'Rhineland-Palatinate', 'Saarland', 'Saxony', 'Saxony-Anhalt', 'Schleswig-Holstein', 'Thuringia']),
  withRegions('IT', 'Italia', 'Región', '00100', /^\d{5}$/, ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino-Alto Adige', 'Umbria', 'Valle d’Aosta', 'Veneto']),
  withRegions('PT', 'Portugal', 'Distrito / región autónoma', '1234-567', /^\d{4}-\d{3}$/, ['Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda', 'Leiria', 'Lisboa', 'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu', 'Açores', 'Madeira']),
  europeanCountry({ code: 'IE', name: 'Irlanda', regionLabel: 'Provincia', provinceLabel: 'Condado', regionRequired: true, provinceRequired: true, postalCodeExample: 'D02 X285', postalCodePattern: /^(?:D6W|[AC-FHKNPRTV-Y]\d{2}) ?[0-9AC-FHKNPRTV-Y]{4}$/i, regions: [
    { code: 'L', name: 'Leinster', provinces: subdivisions(['Carlow', 'Dublin', 'Kildare', 'Kilkenny', 'Laois', 'Longford', 'Louth', 'Meath', 'Offaly', 'Westmeath', 'Wexford', 'Wicklow']) },
    { code: 'M', name: 'Munster', provinces: subdivisions(['Clare', 'Cork', 'Kerry', 'Limerick', 'Tipperary', 'Waterford']) },
    { code: 'C', name: 'Connacht', provinces: subdivisions(['Galway', 'Leitrim', 'Mayo', 'Roscommon', 'Sligo']) },
    { code: 'U', name: 'Ulster (Irlanda)', provinces: subdivisions(['Cavan', 'Donegal', 'Monaghan']) }
  ] }),
  withRegions('NL', 'Países Bajos', 'Provincia', '1012 AB', /^\d{4} ?[A-Z]{2}$/i, ['Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen', 'Limburg', 'North Brabant', 'North Holland', 'Overijssel', 'South Holland', 'Utrecht', 'Zeeland']),
  withRegions('BE', 'Bélgica', 'Región', '1000', /^\d{4}$/, ['Brussels-Capital', 'Flanders', 'Wallonia']),
  withRegions('LU', 'Luxemburgo', 'Cantón', 'L-1234', /^(?:L-)?\d{4}$/i, ['Capellen', 'Clervaux', 'Diekirch', 'Echternach', 'Esch-sur-Alzette', 'Grevenmacher', 'Luxembourg', 'Mersch', 'Redange', 'Remich', 'Vianden', 'Wiltz']),
  withRegions('AT', 'Austria', 'Estado federado', '1010', /^\d{4}$/, ['Burgenland', 'Carinthia', 'Lower Austria', 'Salzburg', 'Styria', 'Tyrol', 'Upper Austria', 'Vienna', 'Vorarlberg']),
  withRegions('CH', 'Suiza', 'Cantón', '8001', /^\d{4}$/, ['Aargau', 'Appenzell Ausserrhoden', 'Appenzell Innerrhoden', 'Basel-Landschaft', 'Basel-Stadt', 'Bern', 'Fribourg', 'Geneva', 'Glarus', 'Graubünden', 'Jura', 'Lucerne', 'Neuchâtel', 'Nidwalden', 'Obwalden', 'Schaffhausen', 'Schwyz', 'Solothurn', 'St. Gallen', 'Thurgau', 'Ticino', 'Uri', 'Valais', 'Vaud', 'Zug', 'Zurich']),
  withRegions('DK', 'Dinamarca', 'Región', '1050', /^\d{4}$/, ['Capital Region', 'Central Denmark', 'North Denmark', 'Region Zealand', 'Southern Denmark']),
  withRegions('SE', 'Suecia', 'Condado', '111 22', /^\d{3} ?\d{2}$/, ['Blekinge', 'Dalarna', 'Gävleborg', 'Gotland', 'Halland', 'Jämtland', 'Jönköping', 'Kalmar', 'Kronoberg', 'Norrbotten', 'Örebro', 'Östergötland', 'Skåne', 'Södermanland', 'Stockholm', 'Uppsala', 'Värmland', 'Västerbotten', 'Västernorrland', 'Västmanland', 'Västra Götaland']),
  withRegions('NO', 'Noruega', 'Condado', '0150', /^\d{4}$/, ['Agder', 'Akershus', 'Buskerud', 'Finnmark', 'Innlandet', 'Møre og Romsdal', 'Nordland', 'Oslo', 'Rogaland', 'Telemark', 'Troms', 'Trøndelag', 'Vestfold', 'Vestland', 'Østfold']),
  withRegions('FI', 'Finlandia', 'Región', '00100', /^\d{5}$/, ['Åland', 'Central Finland', 'Central Ostrobothnia', 'Kainuu', 'Kanta-Häme', 'Kymenlaakso', 'Lapland', 'North Karelia', 'North Ostrobothnia', 'North Savo', 'Ostrobothnia', 'Pirkanmaa', 'Päijät-Häme', 'Satakunta', 'South Karelia', 'South Ostrobothnia', 'South Savo', 'Southwest Finland', 'Uusimaa']),
  withRegions('PL', 'Polonia', 'Voivodato', '00-001', /^\d{2}-\d{3}$/, ['Lower Silesian', 'Kuyavian-Pomeranian', 'Lublin', 'Lubusz', 'Łódź', 'Lesser Poland', 'Masovian', 'Opole', 'Podkarpackie', 'Podlaskie', 'Pomeranian', 'Silesian', 'Świętokrzyskie', 'Warmian-Masurian', 'Greater Poland', 'West Pomeranian']),
  withRegions('CZ', 'República Checa', 'Región', '110 00', /^\d{3} ?\d{2}$/, ['Central Bohemian', 'Hradec Králové', 'Karlovy Vary', 'Liberec', 'Moravian-Silesian', 'Olomouc', 'Pardubice', 'Plzeň', 'Prague', 'South Bohemian', 'South Moravian', 'Ústí nad Labem', 'Vysočina', 'Zlín']),
  withRegions('SK', 'Eslovaquia', 'Región', '811 01', /^\d{3} ?\d{2}$/, ['Banská Bystrica', 'Bratislava', 'Košice', 'Nitra', 'Prešov', 'Trenčín', 'Trnava', 'Žilina']),
  withRegions('HU', 'Hungría', 'Condado / capital', '1051', /^\d{4}$/, ['Bács-Kiskun', 'Baranya', 'Békés', 'Borsod-Abaúj-Zemplén', 'Budapest', 'Csongrád-Csanád', 'Fejér', 'Győr-Moson-Sopron', 'Hajdú-Bihar', 'Heves', 'Jász-Nagykun-Szolnok', 'Komárom-Esztergom', 'Nógrád', 'Pest', 'Somogy', 'Szabolcs-Szatmár-Bereg', 'Tolna', 'Vas', 'Veszprém', 'Zala']),
  withRegions('RO', 'Rumanía', 'Condado / municipio', '010011', /^\d{6}$/, ['Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud', 'Botoșani', 'Brașov', 'Brăila', 'Bucharest', 'Buzău', 'Caraș-Severin', 'Călărași', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița', 'Dolj', 'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița', 'Iași', 'Ilfov', 'Maramureș', 'Mehedinți', 'Mureș', 'Neamț', 'Olt', 'Prahova', 'Sălaj', 'Satu Mare', 'Sibiu', 'Suceava', 'Teleorman', 'Timiș', 'Tulcea', 'Vâlcea', 'Vaslui', 'Vrancea']),
  withRegions('BG', 'Bulgaria', 'Provincia', '1000', /^\d{4}$/, ['Blagoevgrad', 'Burgas', 'Dobrich', 'Gabrovo', 'Haskovo', 'Kardzhali', 'Kyustendil', 'Lovech', 'Montana', 'Pazardzhik', 'Pernik', 'Pleven', 'Plovdiv', 'Razgrad', 'Ruse', 'Shumen', 'Silistra', 'Sliven', 'Smolyan', 'Sofia City', 'Sofia Province', 'Stara Zagora', 'Targovishte', 'Varna', 'Veliko Tarnovo', 'Vidin', 'Vratsa', 'Yambol']),
  withRegions('GR', 'Grecia', 'Región', '105 58', /^\d{3} ?\d{2}$/, ['Attica', 'Central Greece', 'Central Macedonia', 'Crete', 'East Macedonia and Thrace', 'Epirus', 'Ionian Islands', 'North Aegean', 'Peloponnese', 'South Aegean', 'Thessaly', 'West Greece', 'West Macedonia']),
  withRegions('HR', 'Croacia', 'Condado', '10000', /^\d{5}$/, ['Bjelovar-Bilogora', 'Brod-Posavina', 'Dubrovnik-Neretva', 'Istria', 'Karlovac', 'Koprivnica-Križevci', 'Krapina-Zagorje', 'Lika-Senj', 'Međimurje', 'Osijek-Baranja', 'Požega-Slavonia', 'Primorje-Gorski Kotar', 'Šibenik-Knin', 'Sisak-Moslavina', 'Split-Dalmatia', 'Varaždin', 'Virovitica-Podravina', 'Vukovar-Syrmia', 'Zadar', 'Zagreb City', 'Zagreb County']),
  europeanCountry({ code: 'SI', name: 'Eslovenia', postalCodeExample: '1000', postalCodePattern: /^\d{4}$/ }),
  withRegions('EE', 'Estonia', 'Condado', '10111', /^\d{5}$/, ['Harju', 'Hiiu', 'Ida-Viru', 'Järva', 'Jõgeva', 'Lääne', 'Lääne-Viru', 'Pärnu', 'Põlva', 'Rapla', 'Saare', 'Tartu', 'Valga', 'Viljandi', 'Võru']),
  europeanCountry({ code: 'LV', name: 'Letonia', postalCodeExample: 'LV-1050', postalCodePattern: /^(?:LV-)?\d{4}$/i }),
  withRegions('LT', 'Lituania', 'Condado', 'LT-01100', /^(?:LT-)?\d{5}$/i, ['Alytus', 'Kaunas', 'Klaipėda', 'Marijampolė', 'Panevėžys', 'Šiauliai', 'Tauragė', 'Telšiai', 'Utena', 'Vilnius']),
  withRegions('CY', 'Chipre', 'Distrito', '1010', /^\d{4}$/, ['Famagusta', 'Kyrenia', 'Larnaca', 'Limassol', 'Nicosia', 'Paphos']),
  withRegions('MT', 'Malta', 'Región', 'VLT 1117', /^[A-Z]{3} ?\d{4}$/i, ['Central', 'Gozo', 'Northern', 'South Eastern', 'Southern Harbour', 'Western'])
];

export const distributorCountry = (countryCode: string) => distributorCountries.find((country) => country.code === countryCode);
export const regionsForCountry = (countryCode: string) => distributorCountry(countryCode)?.regions ?? [];
export const provincesForRegion = (countryCode: string, regionName: string) => regionsForCountry(countryCode).find((region) => region.name === regionName)?.provinces ?? [];
export const isValidDistributorRegion = (countryCode: string, regionName: string) => {
  const country = distributorCountry(countryCode);
  return Boolean(country && ((!country.regionRequired && !regionName) || country.regions.some((region) => region.name === regionName)));
};
export const isValidDistributorProvince = (countryCode: string, regionName: string, provinceName: string) => {
  const country = distributorCountry(countryCode);
  if (!country) return false;
  if (!country.provinceRequired && !provinceName) return true;
  return provincesForRegion(countryCode, regionName).some((province) => province.name === provinceName);
};
export const isValidDistributorLocation = (countryCode: string, regionName: string, provinceName: string) => isValidDistributorRegion(countryCode, regionName) && isValidDistributorProvince(countryCode, regionName, provinceName);
