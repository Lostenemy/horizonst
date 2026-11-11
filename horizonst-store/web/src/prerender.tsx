import React from 'react';
import { renderToString } from 'react-dom/server';
import { CommercialHome, CommercialInfo, PublicCollaborations } from './pages/CommercialContent';
import { PublicPlans } from './pages/PublicLanding';
import PublicContact from './pages/PublicContact';
import PublicLegal from './pages/PublicLegal';
import { commercialCopy, type CommercialPath } from './lib/commercial-copy';
import type { CollaborationPath } from './lib/domains';
import { indexableCommercialPaths } from '../../src/resources/public-pages';
import { pageTitle } from './lib/presentation';

export const paths = indexableCommercialPaths;
export function render(path: typeof paths[number]) {
  const page = path === '/' ? <CommercialHome /> : path === '/planes' ? <PublicPlans /> : path === '/info-faqs' ? <CommercialInfo /> : path === '/contacto' ? <PublicContact /> : path === '/aviso-legal' ? <PublicLegal page="legal-notice" /> : path === '/privacidad' ? <PublicLegal page="privacy" /> : <PublicCollaborations path={path as CollaborationPath} />;
  const copy = commercialCopy[path as CommercialPath];
  const title = copy?.seo ?? pageTitle(path, true);
  const description = copy?.description ?? (path === '/privacidad' ? 'Información sobre el tratamiento de datos personales en HorizonST.' : 'Información legal y condiciones de uso del sitio HorizonST.');
  return { html: renderToString(page), title, description };
}
