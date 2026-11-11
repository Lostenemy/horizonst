// Public allowlist shared by browser and server. Never place commercial terms here.
export const collaborationProfiles = ['instaladores', 'asesorias-prl', 'ingenierias-frio'] as const;
export const customerProfiles = ['gerencia', 'operaciones', 'prl', 'calidad', 'recursos-humanos', 'mantenimiento', 'finanzas', 'otro'] as const;
export const consultationProfiles = ['empresa', ...collaborationProfiles, ...customerProfiles] as const;
export const consultationPurposes = ['instalacion', 'presupuesto', 'colaboracion'] as const;
export type ConsultationProfile = typeof consultationProfiles[number];
export type ConsultationPurpose = typeof consultationPurposes[number];
export type ContactContext = {
  companyName?: string;
  profile?: ConsultationProfile;
  purpose?: ConsultationPurpose;
};
