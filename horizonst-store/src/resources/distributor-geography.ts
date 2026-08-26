export type DistributorProvince = { code: string; name: string };
export type DistributorRegion = { code: string; name: string; provinces: DistributorProvince[] };
export type DistributorCountry = { code: string; name: string; regions: DistributorRegion[] };

export const distributorCountries: DistributorCountry[] = [{
  code: 'ES',
  name: 'España',
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
}];

export const regionsForCountry = (countryCode: string) => distributorCountries.find((country) => country.code === countryCode)?.regions ?? [];
export const provincesForRegion = (countryCode: string, regionName: string) => regionsForCountry(countryCode).find((region) => region.name === regionName)?.provinces ?? [];
export const isValidDistributorLocation = (countryCode: string, regionName: string, provinceName: string) => provincesForRegion(countryCode, regionName).some((province) => province.name === provinceName);
