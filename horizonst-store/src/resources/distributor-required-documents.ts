export type DistributorDocumentStatus = 'pending' | 'approved' | 'rejected' | 'replaced';

export type DistributorDocumentRequirement = {
  code: string;
  label: string;
  description: string;
  acceptedTypes: string[];
};

export const distributorDocumentTypes = [
  'tax_id', 'census_registration', 'company_registration', 'business_registration', 'business_activity',
  'certificado_censal', 'modelo_036', 'modelo_037', 'cif_empresa', 'certificado_autonomo', 'escrituras', 'otro'
] as const;

const commonTaxId: DistributorDocumentRequirement = {
  code: 'tax_id',
  label: 'Identificación fiscal / VAT',
  description: 'Documento oficial que acredita el identificador fiscal o VAT de la empresa.',
  acceptedTypes: ['tax_id']
};

const countryRequirements: Record<string, DistributorDocumentRequirement[]> = {
  ES: [
    { ...commonTaxId, label: 'NIF / CIF de la empresa', acceptedTypes: ['tax_id', 'cif_empresa'] },
    {
      code: 'census_registration',
      label: 'Alta censal (modelo 036/037 o certificado censal)',
      description: 'Documento que acredita el alta de la actividad ante la administración tributaria.',
      acceptedTypes: ['census_registration', 'modelo_036', 'modelo_037', 'certificado_censal', 'certificado_autonomo']
    },
    {
      code: 'business_registration',
      label: 'Acreditación empresarial',
      description: 'Escrituras o documento equivalente que acredita la existencia de la empresa.',
      acceptedTypes: ['business_registration', 'escrituras']
    }
  ],
  GB: [
    {
      code: 'company_registration',
      label: 'Company Registration / Companies House document',
      description: 'Documento oficial de registro de la empresa en Reino Unido.',
      acceptedTypes: ['company_registration']
    },
    { ...commonTaxId, label: 'VAT Certificate o identificación fiscal equivalente' },
    {
      code: 'business_activity',
      label: 'Proof of business registration',
      description: 'Documento que acredita que la actividad empresarial está registrada.',
      acceptedTypes: ['business_activity', 'business_registration']
    }
  ]
};

const genericRequirements: DistributorDocumentRequirement[] = [
  commonTaxId,
  {
    code: 'company_registration',
    label: 'Certificado de registro de empresa',
    description: 'Documento oficial de registro mercantil o empresarial del país.',
    acceptedTypes: ['company_registration']
  },
  {
    code: 'business_activity',
    label: 'Documento acreditativo de actividad',
    description: 'Documento oficial que acredita la actividad económica de la empresa.',
    acceptedTypes: ['business_activity', 'business_registration']
  }
];

export const requiredDistributorDocuments = (countryCode: string | null | undefined): DistributorDocumentRequirement[] =>
  countryRequirements[String(countryCode ?? '').toUpperCase()] ?? genericRequirements;

export const distributorDocumentRequirementForType = (countryCode: string | null | undefined, documentType: string): DistributorDocumentRequirement | undefined =>
  requiredDistributorDocuments(countryCode).find((requirement) => requirement.code === documentType || requirement.acceptedTypes.includes(documentType));

export const isAllowedDistributorDocumentType = (countryCode: string | null | undefined, documentType: string): boolean =>
  documentType === 'otro' || distributorDocumentRequirementForType(countryCode, documentType) !== undefined;

export const canReplaceDistributorDocument = (status: string | null | undefined): boolean => !status || status === 'pending' || status === 'rejected';

export const missingApprovedDistributorDocuments = (
  countryCode: string | null | undefined,
  documents: Array<{ document_type: string; status: string }>
): DistributorDocumentRequirement[] => requiredDistributorDocuments(countryCode).filter((requirement) =>
  !documents.some((document) => document.status === 'approved' && requirement.acceptedTypes.includes(document.document_type))
);
